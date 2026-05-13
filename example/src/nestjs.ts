import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './nestjs/app.module.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false })
  await app.listen(8080)
  console.log('Silkweave NestJS server listening on http://localhost:8080')
  console.log('  REST:   POST http://localhost:8080/api/users/list (or GET for queries)')
  console.log('  tRPC:   http://localhost:8080/trpc/usersList')
  console.log('  MCP:    http://localhost:8080/mcp')
}

bootstrap()
