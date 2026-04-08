import { randomUUID } from 'crypto'
import { writeFile } from 'fs/promises'

export interface SideloadResource {
  id: string
  name: string
  contentType: string
  size: number
}

export async function createSideloadResource(buffer: Buffer, { name, contentType }: Pick<SideloadResource, 'name' | 'contentType'>) {
  const id = randomUUID()
  const resource: SideloadResource = { id, name, contentType, size: buffer.length }
  await Promise.all([
    writeFile(`resources/${id}`, buffer),
    writeFile(`resources/${id}.json`, JSON.stringify(resource), 'utf-8')
  ])
  return resource
}
