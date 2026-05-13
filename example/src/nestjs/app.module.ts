import { Module } from '@nestjs/common'
import { mcp, rest, SilkweaveModule, trpc } from '@silkweave/nestjs'
import { AdminGuard } from './admin.guard.js'
import { UserActions } from './user.actions.js'

@Module({
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'silkweave-nestjs', description: 'Silkweave NestJS example', version: '1.0.0' },
      adapters: [
        rest({ basePath: '/api' }),
        trpc({ basePath: '/trpc' }),
        mcp({ basePath: '/' })
      ]
    })
  ],
  providers: [AdminGuard, UserActions]
})
export class AppModule {}
