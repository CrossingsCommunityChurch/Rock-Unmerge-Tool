/*
Unmerge Person with Alias Detection
Author: Pastor Jeremy Parker
Summary: This script is designed to help you recover from an accidental merge in RockRMS.
Instructions:
Before you run this script, you should create a new record for the person who was accidentally merged.
If the person was the only one in his/her family, create that record in your current Rock instance in a new family.
If the person was a part of a family with others, create the record in your current Rock instance in the original family.
Once you're done with that, you'll need to take the following steps:
 1. Change the @PersonFirstName and @PersonLastName values for the person you're restoring (be sure they're the same in your backup and current Rock database!)
 -- 1a. You may alternately find relevant Ids for @previousPersonId, @currentPersonId, and @currentPersonAliasId and input those below. Just be sure to comment out the lookup of those variables based on the name if you go that route.
 2. REPLACE ALL instances of rockrms-backup in this script with the name of your BACKUP database.
 3. If your current (Live) database for Rock is named something other than rockrms, replace the rockrms reference at the start of this script with your database name.
 3. Run this script first with the ROLLBACK option at the end of the script uncommented to ensure the results match your expectations.
 4. Comment out the ROLLBACK statement below and un-comment the COMMIT statement before running the script to finalize your changes.
*/
USE rockrms;

IF OBJECT_ID('tempdb..#aliasColumns') IS NOT NULL DROP TABLE #aliasColumns
IF OBJECT_ID('tempdb..#previousAliasIds') IS NOT NULL DROP TABLE #previousAliasIds
IF OBJECT_ID('tempdb..#tablesToUpdate') IS NOT NULL DROP TABLE #tablesToUpdate
GO

BEGIN TRAN

DECLARE @PersonFirstName varchar(100) = 'Sam'
DECLARE @PersonLastName varchar(100) = 'Test'
DECLARE @previousPersonId int --= 2981 -- This is the original PersonId FROM your backup Rock database of the person who was deleted when the merge happened
DECLARE @currentPersonId int --= 122465 -- This is the PersonId of the new person record in your current Rock database created when you re-added the person as a new record via the Rock web app
DECLARE @currentPersonAliasId int --= 122468 -- This is the PersonAlias Id of the new person record from re-adding the person via the Rock web app
DECLARE @ColumnName sysname
DECLARE @TableName sysname
DECLARE @TableQuery varchar(1000)
DECLARE @RecordsQuery varchar(1000)
DECLARE @AliasCountQuery nvarchar(1000)
DECLARE @AliasCountParams nvarchar(100) = N'@AliasCount int OUT'
DECLARE @AliasCount int
DECLARE @UpdateKeysQuery nvarchar(1000)

-- You can either manually specify the person and alias Ids above, or automate as follows
SET @previousPersonId = (SELECT TOP 1 Id FROM [rockrms-backup].[dbo].[Person] WHERE FirstName=@PersonFirstName AND LastName=@PersonLastName)
SET @currentPersonId = (SELECT TOP 1 Id FROM [rockrms].[dbo].[Person] WHERE FirstName=@PersonFirstName AND LastName=@PersonLastName)
SET @currentPersonAliasId = (SELECT PrimaryAliasId FROM [rockrms].[dbo].[Person] WHERE Id=@currentPersonId)

SELECT Id as PersonAliasId
INTO #previousAliasIds
FROM [rockrms-backup].[dbo].[PersonAlias] WHERE PersonId=@previousPersonId

CREATE TABLE #tablesToUpdate(
	TableName sysname,
	ColumnName sysname,
	AliasType varchar(50),
	RecordCount int,
	ProcessedFlag bit
)

-- Just some helpful statements you can preview in your results before you commit changes
SELECT 'Records for the Backup person in the table below will be shifted to the Current person in that same table.' as [Note:]
SELECT 'Backup' AS [Source], @previousPersonId as [PersonId], pp.* FROM [rockrms-backup].[dbo].Person pp WHERE pp.Id=@previousPersonId
UNION
SELECT 'Current' AS [Source], @currentPersonId as [PersonId], p.* FROM [dbo].Person p WHERE p.Id=@currentPersonId

-- pull all tables with columns that have PersonAliasId in the column name so that we can see if we have records for this person in those tables
SELECT c.[name]  AS 'ColumnName'
		,'[' + (SCHEMA_NAME(t.schema_id) + '].[' + t.name + ']') AS 'TableName'
		,ProcessedFlag=CAST(0 as bit)
INTO #aliasColumns
FROM sys.columns c
	JOIN sys.tables t ON c.object_id = t.object_id
-- ignoring autiting (Created/Modified) fields and allowing for special treatment of groups to leave family alone below
WHERE c.[name] LIKE '%PersonAliasId%' AND c.[name] NOT LIKE 'CreatedBy%' AND c.[name] NOT LIKE 'ModifiedBy%' AND t.[Name] NOT LIKE '%GroupMember%'
ORDER BY TableName, ColumnName

-- see which of the tables with alias columns have records we care to update in the database and add them to a table for processing
WHILE EXISTS(SELECT * FROM #aliasColumns WHERE ProcessedFlag=0)
BEGIN
	SELECT TOP 1 @ColumnName=ColumnName, @TableName=TableName FROM #aliasColumns WHERE ProcessedFlag=0
	SET @AliasCountQuery=N'SELECT @AliasCount=(SELECT COUNT(*) FROM ' + @TableName +  ' WHERE [' + @ColumnName + '] IN (SELECT PersonAliasId FROM #previousAliasIds))'
	exec sp_executesql @AliasCountQuery, @AliasCountParams, @AliasCount = @AliasCount OUT

	INSERT #tablesToUpdate(TableName, ColumnName, AliasType, RecordCount, ProcessedFlag) VALUES (@TableName, @ColumnName, 'PersonAlias', @AliasCount, 0)

	UPDATE #aliasColumns SET ProcessedFlag=1 WHERE ColumnName=@ColumnName AND TableName=@TableName
END

-- this statement allows you to preview what tables and columns (and how many records for each) will be updated to reflect the new PersonAlias Id
SELECT * FROM #tablesToUpdate WHERE RecordCount > 0

--1. Find Group Member Ids in the backup database and UPDATE the corresponding group member records in the live DB with the new PersonId
UPDATE gm
SET PersonId = @currentPersonId
FROM GroupMember gm
JOIN (
		SELECT Id
		FROM [rockrms-backup].dbo.GroupMember ogm
		WHERE PersonId = @previousPersonId
		) ogmid ON gm.Id = ogmid.Id
JOIN [Group] g ON gm.GroupId = g.Id
WHERE g.GroupTypeId <> 10 -- avoiding families, group type 10

--2. Find orphaned Person Attribute Ids matching the old PersonId in the live database and UPDATE them with the new PersonId
UPDATE av
SET av.EntityId = @currentPersonId
FROM AttributeValue av
JOIN Attribute a ON av.AttributeId = a.Id
WHERE a.EntityTypeId = 15 -- Rock.Model.Person Entity Type Id = 15
and av.EntityId = @previousPersonId

--3. Update any user logins for the user to shift them back to the person's record
UPDATE UserLogin
SET PersonId = @currentPersonId
WHERE Id IN (
	SELECT oul.Id
	FROM [rockrms-backup].[dbo].[UserLogin] oul
	WHERE oul.PersonId = @previousPersonId
)

--4. Find matching alias Ids in the backup database and UPDATE the corresponding table records in the live DB with the new PersonAlias Id
WHILE EXISTS(SELECT * FROM #tablesToUpdate WHERE RecordCount > 0 AND AliasType='PersonAlias' AND ProcessedFlag=0)
BEGIN
	SELECT TOP 1 @TableName=TableName, @ColumnName=ColumnName FROM #tablesToUpdate WHERE RecordCount > 0 AND AliasType='PersonAlias' AND ProcessedFlag=0
	SET @UpdateKeysQuery=
	N'UPDATE tbl
	SET ' + @ColumnName + ' = ' + CAST(@currentPersonAliasId as nvarchar) + '
	FROM ' + @TableName + ' tbl
	JOIN (
		SELECT Id
		FROM [rockrms-backup].' + @TableName + '
		WHERE ' + @ColumnName + ' IN (SELECT PersonAliasId FROM #previousAliasIds)
		) tblIds ON tbl.Id = tblIds.Id'
	exec sp_sqlexec @UpdateKeysQuery

	UPDATE #tablesToUpdate SET ProcessedFlag=1 WHERE TableName=@TableName AND ColumnName=@ColumnName AND AliasType='PersonAlias'
END

--Comment out the ROLLBACK TRANS statement below and uncomment the COMMIT TRANS statement once you have previewed results and are confident that the changes are desired
ROLLBACK TRAN
--COMMIT TRAN
