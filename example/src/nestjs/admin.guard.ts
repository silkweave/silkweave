import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>()
    const token = req.headers?.['x-admin-token']
    return token === 'secret-admin-token'
  }
}
