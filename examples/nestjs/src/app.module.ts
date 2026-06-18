import { Module } from '@nestjs/common'
import { SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { trpc } from '@silkweave/nestjs/trpc'
import { typegen } from '@silkweave/nestjs/typegen'
import { AdminGuard } from './admin.guard.js'
import { UsersController } from './users.controller.js'

@Module({
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'silkweave-nestjs', description: 'Silkweave NestJS example', version: '1.0.0' },
      adapters: [
        mcp({ basePath: '/mcp' }), // @Mcp methods → MCP tools
        trpc({ basePath: '/trpc' }), // @Trpc methods → tRPC procedures
        typegen({ path: './src/generated/appRouter.ts' }) // @Trpc procedures → AppRouter type
      ]
    })
  ],
  controllers: [UsersController],
  providers: [AdminGuard]
})
export class AppModule {}
