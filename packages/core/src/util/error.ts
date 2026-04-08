export class SilkweaveError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500
  ) {
    super(message)
    this.name = 'SilkweaveError'
  }
}

export function notFound(message = 'Not found') {
  return new SilkweaveError(message, 'not_found', 404)
}

export function badRequest(message = 'Bad request') {
  return new SilkweaveError(message, 'bad_request', 400)
}

export function forbidden(message = 'Forbidden') {
  return new SilkweaveError(message, 'forbidden', 403)
}

export function internal(message = 'Internal error') {
  return new SilkweaveError(message, 'internal', 500)
}
