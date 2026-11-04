declare module 'node:child_process' {
  export interface ChildProcessStream {
    on(event: 'data', listener: (chunk: string | Buffer) => void): ChildProcessStream;
  }

  export interface ChildProcessStdin {
    write(value: string): boolean;
    end(): void;
  }

  export interface ChildProcess {
    readonly stdin: ChildProcessStdin;
    readonly stdout: ChildProcessStream;
    readonly stderr: ChildProcessStream;
    once(event: 'error', listener: (error: Error) => void): ChildProcess;
    once(event: 'close', listener: (code: number) => void): ChildProcess;
    kill(signal: string): void;
  }

  export function spawn(
    command: string,
    args: readonly string[],
    options: { readonly stdio?: readonly string[]; readonly windowsHide?: boolean },
  ): ChildProcess;
}
