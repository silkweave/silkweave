import ts, { factory as f } from 'typescript'
import { type Action } from '@silkweave/core'
import { pascalCase } from 'change-case'
import { zodToTs, printNode } from './zodToTs.js'

export function generateDts(actions: Action[]): string {
  const statements: ts.Statement[] = []

  for (const action of actions) {
    const name = pascalCase(action.name)

    statements.push(
      f.createInterfaceDeclaration(
        [f.createModifier(ts.SyntaxKind.ExportKeyword)],
        `${name}Input`,
        undefined,
        undefined,
        membersFromTypeLiteral(zodToTs(action.input))
      )
    )

    if (action.output) {
      statements.push(
        f.createInterfaceDeclaration(
          [f.createModifier(ts.SyntaxKind.ExportKeyword)],
          `${name}Output`,
          undefined,
          undefined,
          membersFromTypeLiteral(zodToTs(action.output))
        )
      )
    }
  }

  return statements.map(printNode).join('\n\n') + '\n'
}

function membersFromTypeLiteral(node: ts.TypeNode): ts.TypeElement[] {
  if (ts.isTypeLiteralNode(node)) {
    return [...node.members]
  }
  return [f.createIndexSignature(
    undefined,
    [f.createParameterDeclaration(undefined, undefined, 'key', undefined, f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword))],
    node
  )]
}
