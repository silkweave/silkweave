import type { ArgumentsHost, ContextType, ExecutionContext, Type } from '@nestjs/common'

/** Subset of `HttpArgumentsHost` we need — re-declared inline to avoid deep `@nestjs/common/interfaces` imports. */
interface HttpHost {
  getRequest<T = unknown>(): T
  getResponse<T = unknown>(): T
  getNext<T = unknown>(): T
}

interface RpcHost {
  getData<T = unknown>(): T
  getContext<T = unknown>(): T
}

interface WsHost {
  getClient<T = unknown>(): T
  getData<T = unknown>(): T
  getPattern(): string
}

/**
 * Minimal `ExecutionContext` impl Nest guards can consume. We only need
 * `switchToHttp()` to work for our HTTP-backed transports; the RPC/WS shims are
 * stubbed so guards that introspect type can still call them without crashing.
 */
export class SilkweaveExecutionContext implements ExecutionContext, ArgumentsHost {
  constructor(
    private readonly args: unknown[],
    private readonly classRef: Type<unknown>,
    private readonly handler: (...handlerArgs: unknown[]) => unknown,
    private readonly contextType: string = 'http'
  ) {}

  getType<T extends string = ContextType>(): T {
    return this.contextType as T
  }

  getClass<T = unknown>(): Type<T> {
    return this.classRef as Type<T>
  }

  getHandler(): (...handlerArgs: unknown[]) => unknown {
    return this.handler
  }

  getArgs<T extends unknown[] = unknown[]>(): T {
    return this.args as T
  }

  getArgByIndex<T = unknown>(index: number): T {
    return this.args[index] as T
  }

  switchToHttp(): HttpHost {
    return {
      getRequest: <T = unknown>(): T => this.args[0] as T,
      getResponse: <T = unknown>(): T => this.args[1] as T,
      getNext: <T = unknown>(): T => this.args[2] as T
    }
  }

  switchToRpc(): RpcHost {
    return {
      getData: <T = unknown>(): T => this.args[0] as T,
      getContext: <T = unknown>(): T => this.args[1] as T
    }
  }

  switchToWs(): WsHost {
    return {
      getClient: <T = unknown>(): T => this.args[0] as T,
      getData: <T = unknown>(): T => this.args[1] as T,
      getPattern: (): string => ''
    }
  }
}
