/* eslint-disable @typescript-eslint/no-explicit-any */
import ts, { factory as f } from 'typescript'
import { z } from 'zod'

export function zodToTs(schema: z.ZodTypeAny): ts.TypeNode {
  const def = (schema as any)._zod.def
  const handler = typeHandlers[def.type as string]
  return handler ? handler(def) : f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
}

const keyword = (kind: ts.KeywordTypeSyntaxKind) => () =>
  f.createKeywordTypeNode(kind)

type TypeHandler = (def: any) => ts.TypeNode

const typeHandlers: Record<string, TypeHandler> = {
  string: keyword(ts.SyntaxKind.StringKeyword),
  number: keyword(ts.SyntaxKind.NumberKeyword),
  nan: keyword(ts.SyntaxKind.NumberKeyword),
  bigint: keyword(ts.SyntaxKind.BigIntKeyword),
  boolean: keyword(ts.SyntaxKind.BooleanKeyword),
  undefined: keyword(ts.SyntaxKind.UndefinedKeyword),
  void: keyword(ts.SyntaxKind.VoidKeyword),
  any: keyword(ts.SyntaxKind.AnyKeyword),
  unknown: keyword(ts.SyntaxKind.UnknownKeyword),
  never: keyword(ts.SyntaxKind.NeverKeyword),
  symbol: keyword(ts.SyntaxKind.SymbolKeyword),
  date: () => f.createTypeReferenceNode('Date'),
  null: () => f.createLiteralTypeNode(f.createNull()),
  file: () => f.createTypeReferenceNode('File'),

  literal: (def) => {
    const members = def.values.map(literalToTypeNode)
    return members.length === 1 ? members[0] : f.createUnionTypeNode(members)
  },

  enum: (def) => {
    return f.createUnionTypeNode(Object.values(def.entries).map(literalToTypeNode))
  },

  array: (def) => f.createArrayTypeNode(zodToTs(def.element)),

  object: (def) => {
    const members: ts.TypeElement[] = Object.entries(def.shape as Record<string, z.ZodTypeAny>)
      .map(([key, memberSchema]) => {
        const isOptional = (memberSchema as any)._zod.optout
        return f.createPropertySignature(
          undefined,
          identifierOrString(key),
          isOptional ? f.createToken(ts.SyntaxKind.QuestionToken) : undefined,
          zodToTs(memberSchema)
        )
      })

    if (def.catchall) {
      members.push(indexSignature(zodToTs(def.catchall)))
    }

    return f.createTypeLiteralNode(members)
  },

  record: (def) => {
    return f.createTypeLiteralNode([indexSignature(zodToTs(def.valueType), zodToTs(def.keyType))])
  },

  tuple: (def) => f.createTupleTypeNode((def.items as z.ZodTypeAny[]).map(zodToTs)),
  union: (def) => f.createUnionTypeNode((def.options as z.ZodTypeAny[]).map(zodToTs)),
  intersection: (def) => f.createIntersectionTypeNode([zodToTs(def.left), zodToTs(def.right)]),

  optional: (def) => f.createUnionTypeNode([
    zodToTs(def.innerType),
    f.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword)
  ]),

  nullable: (def) => f.createUnionTypeNode([
    zodToTs(def.innerType),
    f.createLiteralTypeNode(f.createNull())
  ]),

  default: (def) => zodToTs(def.innerType),
  prefault: (def) => zodToTs(def.innerType),
  catch: (def) => zodToTs(def.innerType),
  lazy: (def) => zodToTs(def.getter()),
  pipe: (def) => zodToTs(def.out),

  readonly: (def) => {
    const inner = zodToTs(def.innerType)
    if (ts.isArrayTypeNode(inner) || ts.isTupleTypeNode(inner)) {
      return f.createTypeOperatorNode(ts.SyntaxKind.ReadonlyKeyword, inner)
    }
    return inner
  },

  set: (def) => f.createTypeReferenceNode('Set', [zodToTs(def.valueType)]),
  map: (def) => f.createTypeReferenceNode('Map', [zodToTs(def.keyType), zodToTs(def.valueType)]),
  promise: (def) => f.createTypeReferenceNode('Promise', [zodToTs(def.innerType)])
}

export function printNode(node: ts.Node): string {
  const sourceFile = ts.createSourceFile('typegen.d.ts', '', ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)
}

function indexSignature(valueType: ts.TypeNode, keyType?: ts.TypeNode): ts.IndexSignatureDeclaration {
  return f.createIndexSignature(
    undefined,
    [f.createParameterDeclaration(undefined, undefined, 'key', undefined, keyType ?? f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword))],
    valueType
  )
}

const identifierRE = /^[$A-Z_a-z][\w$]*$/

function identifierOrString(name: string) {
  return identifierRE.test(name)
    ? f.createIdentifier(name)
    : f.createStringLiteral(name)
}

function literalToTypeNode(value: unknown): ts.TypeNode {
  switch (typeof value) {
    case 'string':
      return f.createLiteralTypeNode(f.createStringLiteral(value))
    case 'number':
      return value < 0
        ? f.createLiteralTypeNode(f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(Math.abs(value))))
        : f.createLiteralTypeNode(f.createNumericLiteral(value))
    case 'bigint':
      return f.createLiteralTypeNode(f.createBigIntLiteral(`${value}n`))
    case 'boolean':
      return f.createLiteralTypeNode(value ? f.createTrue() : f.createFalse())
    default:
      return f.createLiteralTypeNode(f.createNull())
  }
}
