import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false })

  // The controllers are ordinary Nest controllers, so @nestjs/swagger documents
  // them natively - no Silkweave-specific merging required.
  const config = new DocumentBuilder().setTitle('Silkweave NestJS example').setVersion('1.0.0').build()
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config))

  await app.listen(8080)
  console.log('Silkweave NestJS server listening on http://localhost:8080')
  console.log('  REST:    GET  http://localhost:8080/users/1  (native controller)')
  console.log('  Swagger: http://localhost:8080/api/docs')
  console.log('  MCP:     http://localhost:8080/mcp    (UsersList / UsersGet / UsersBan tools)')
  console.log('  tRPC:    http://localhost:8080/trpc   (usersList / usersGet / usersBan / usersWatch)')
  console.log('  Types:   ./src/generated/appRouter.ts (AppRouter, regenerated on boot)')
}

bootstrap()
