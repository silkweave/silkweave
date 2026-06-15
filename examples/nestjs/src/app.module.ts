import { Module } from '@nestjs/common'
import { mcp, SilkweaveModule } from '@silkweave/nestjs'
import { AdminGuard } from './admin.guard.js'
import { UsersController } from './users.controller.js'

@Module({
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'silkweave-nestjs', description: 'Silkweave NestJS example', version: '1.0.0' },
      adapters: [mcp({ basePath: '/mcp' })]
    })
  ],
  controllers: [UsersController],
  providers: [AdminGuard]
})
export class AppModule {}
