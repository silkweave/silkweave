import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { addSilkweaveActions } from '@silkweave/nestjs'
import { AppModule } from './app.module.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false })

  // @nestjs/swagger scans controllers; Silkweave actions are registered directly
  // on the HTTP adapter, so we merge them into the document explicitly.
  const config = new DocumentBuilder()
    .setTitle('Silkweave NestJS example')
    .setVersion('1.0.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  addSilkweaveActions(app, document)
  SwaggerModule.setup('api/docs', app, document)

  await app.listen(8080)
  console.log('Silkweave NestJS server listening on http://localhost:8080')
  console.log('  REST:    GET  http://localhost:8080/api/users/1 (or /api/users/list)')
  console.log('  Swagger: http://localhost:8080/api/docs')
  console.log('  tRPC:    http://localhost:8080/trpc/usersList')
  console.log('  MCP:     http://localhost:8080/mcp')
}

bootstrap()
