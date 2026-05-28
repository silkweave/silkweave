import { type Action, isStreamingAction } from '@silkweave/core'
import { camelCase } from 'change-case'
import ts, { factory as f } from 'typescript'
import { printNode, zodToTs } from './zodToTs.js'

const TRPC_PROCEDURE_TYPES = ['AnyTRPCRootTypes', 'TRPCBuiltRouter', 'TRPCMutationProcedure', 'TRPCQueryProcedure', 'TRPCSubscriptionProcedure'] as const

/**
 * Emit an `AppRouter` type alias compatible with `createTRPCClient<AppRouter>()`.
 *
 * The router mirrors what `@silkweave/trpc`'s `buildRouter()` builds at runtime
 * and what `InferTrpcRouter<S>` infers at the type level: each action name
 * collapses to camelCase, queries become `TRPCQueryProcedure`, mutations
 * `TRPCMutationProcedure`, with the action's input/output types embedded.
 */
export function generateTrpcRouter(actions: Action[]): string {
  const importDecl = f.createImportDeclaration(
    undefined,
    f.createImportClause(
      true,
      undefined,
      f.createNamedImports(TRPC_PROCEDURE_TYPES.map((name) =>
        f.createImportSpecifier(false, undefined, f.createIdentifier(name))
      ))
    ),
    f.createStringLiteral('@trpc/server')
  )

  const rootTypeAlias = f.createTypeAliasDeclaration(
    undefined,
    f.createIdentifier('TrpcRootTypes'),
    undefined,
    f.createIntersectionTypeNode([
      f.createTypeLiteralNode([
        f.createPropertySignature(undefined, 'ctx', undefined, f.createTypeReferenceNode('object')),
        f.createPropertySignature(undefined, 'meta', undefined, f.createTypeReferenceNode('object')),
        f.createPropertySignature(undefined, 'errorShape', undefined, f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)),
        f.createPropertySignature(undefined, 'transformer', undefined, f.createLiteralTypeNode(f.createFalse()))
      ]),
      f.createTypeReferenceNode('AnyTRPCRootTypes')
    ])
  )

  const procedures = actions.map((action) => {
    const streaming = isStreamingAction(action)
    const procedureType = streaming
      ? 'TRPCSubscriptionProcedure'
      : (action.kind === 'query' ? 'TRPCQueryProcedure' : 'TRPCMutationProcedure')
    const outputNode = streaming
      ? (action.chunk ? zodToTs(action.chunk) : f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword))
      : (action.output ? zodToTs(action.output) : f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword))
    return f.createPropertySignature(
      undefined,
      camelCase(action.name),
      undefined,
      f.createTypeReferenceNode(procedureType, [
        f.createTypeLiteralNode([
          f.createPropertySignature(undefined, 'meta', undefined, f.createTypeReferenceNode('object')),
          f.createPropertySignature(undefined, 'input', undefined, zodToTs(action.input)),
          f.createPropertySignature(undefined, 'output', undefined, outputNode)
        ])
      ])
    )
  })

  const routerAlias = f.createTypeAliasDeclaration(
    [f.createModifier(ts.SyntaxKind.ExportKeyword)],
    f.createIdentifier('AppRouter'),
    undefined,
    f.createTypeReferenceNode('TRPCBuiltRouter', [
      f.createTypeReferenceNode('TrpcRootTypes'),
      f.createTypeLiteralNode(procedures)
    ])
  )

  return [importDecl, rootTypeAlias, routerAlias].map(printNode).join('\n\n') + '\n'
}
