import { z } from 'zod/v4'
import { Action } from './action.js'
import { unwrap } from './zod.js'

export type ActionLintCode =
  | 'missing-description'
  | 'short-description'
  | 'undescribed-params'
  | 'some-undescribed-params'

export interface ActionLintWarning {
  action: string
  code: ActionLintCode
  message: string
}

/** A description shorter than this reads as a placeholder to an agent picking a tool. */
const MIN_DESCRIPTION_LENGTH = 12

/** A field's `.describe()` text, looking through optional/default/nullable/readonly wrappers. */
function describedText(field: z.ZodTypeAny): string | undefined {
  if (field.description) { return field.description }
  const [base] = unwrap(field)
  return base.description
}

/**
 * Static checks for agent-hostile action definitions - the cheap mistakes that
 * quietly degrade tool-use: a missing or throwaway description (the model reads
 * it to decide when to call the tool) and undescribed input parameters (the
 * model guesses what to pass). Pure + side-effect-free; `reportActionLint` wires
 * it to a warn sink, and `silkweave().start()` runs it automatically.
 */
export function lintActions(actions: Action[]): ActionLintWarning[] {
  const warnings: ActionLintWarning[] = []
  for (const action of actions) {
    const description = action.description?.trim() ?? ''
    if (!description) {
      warnings.push({
        action: action.name,
        code: 'missing-description',
        message: `Action "${action.name}" has no description - MCP clients show it to the model to decide when to call the tool. Add a clear, specific sentence.`
      })
    } else if (description.length < MIN_DESCRIPTION_LENGTH) {
      warnings.push({
        action: action.name,
        code: 'short-description',
        message: `Action "${action.name}" description is very short ("${description}"). A fuller sentence helps agents choose the right tool.`
      })
    }

    const shape = action.input?.shape ?? {}
    const params = Object.keys(shape)
    const undescribed = params.filter((name) => !describedText(shape[name]))
    if (params.length > 0 && undescribed.length === params.length) {
      warnings.push({
        action: action.name,
        code: 'undescribed-params',
        message: `Action "${action.name}" has no described input parameters (${params.join(', ')}). Add .describe() to each field so agents pass correct values.`
      })
    } else if (undescribed.length > 0) {
      warnings.push({
        action: action.name,
        code: 'some-undescribed-params',
        message: `Action "${action.name}" input fields lack descriptions: ${undescribed.join(', ')}. Add .describe() for better agent tool-use.`
      })
    }
  }
  return warnings
}

/**
 * Run `lintActions` and emit each warning through `warn` (default `console.warn`,
 * which goes to stderr - safe even for the stdio MCP transport). Returns the
 * warnings so callers can also inspect or suppress them.
 */
export function reportActionLint(
  actions: Action[],
  warn: (message: string) => void = (message) => { console.warn(message) }
): ActionLintWarning[] {
  const warnings = lintActions(actions)
  for (const warning of warnings) {
    warn(`[silkweave] ${warning.message}`)
  }
  return warnings
}
