import * as React from 'react'
import { Button } from './ui/button'

interface State {
  error: Error | null
  info: React.ErrorInfo | null
}

/** Catches render-time errors anywhere below it and shows a useful message
 *  instead of letting React unmount the entire tree to a blank white screen. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to devtools so the stack survives even if the user doesn't expand the panel.
    // eslint-disable-next-line no-console
    console.error('Renderer error caught by ErrorBoundary:', error, info)
    this.setState({ info })
  }

  reset = (): void => this.setState({ error: null, info: null })

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen p-8 bg-background text-foreground">
        <div className="max-w-3xl mx-auto space-y-4">
          <h1 className="text-xl font-semibold text-destructive">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The UI hit a render-time error. Your data is safe — no commit was triggered by this.
          </p>
          <pre className="text-xs font-mono bg-muted/40 rounded p-3 overflow-auto">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          {this.state.info && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Component stack</summary>
              <pre className="mt-2 font-mono bg-muted/40 rounded p-3 overflow-auto">
                {this.state.info.componentStack}
              </pre>
            </details>
          )}
          <Button onClick={this.reset}>Reset and try again</Button>
        </div>
      </div>
    )
  }
}
