export class ThrottoError extends Error {
  override readonly name: string = 'ThrottoError'
}

export class ConfigError extends ThrottoError {
  override readonly name = 'ConfigError'
}

export class StoreError extends ThrottoError {
  override readonly name = 'StoreError'

  constructor(
    message: string,
    public readonly storeName?: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class TimeoutError extends ThrottoError {
  override readonly name = 'TimeoutError'

  constructor(
    message: string,
    public readonly timeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export class RateLimitExceededError extends ThrottoError {
  override readonly name = 'RateLimitExceededError'

  constructor(
    message: string,
    public readonly retryAfter: number,
    public readonly limit: number,
    public readonly resetAt: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
