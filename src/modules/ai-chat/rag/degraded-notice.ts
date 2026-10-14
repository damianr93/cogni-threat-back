import { DegradedReason } from '../types/chat.types';

const HEADER = '\n\n> **Modo degradado:** ';
const TAIL = 'puede estar incompleta.';

/**
 * Neutral Spanish notice appended (and persisted) with every answer that was
 * not produced by the regular tool loop. Machine fields stay in English.
 */
export function degradedNotice(reason: DegradedReason, model: string): string {
  switch (reason) {
    case 'model_without_tools':
      return `${HEADER}el modelo \`${model}\` no utiliza herramientas; esta respuesta se basa en una búsqueda automática y ${TAIL}`;
    case 'no_tool_calls':
      return `${HEADER}el modelo \`${model}\` no solicitó herramientas para esta consulta; esta respuesta se basa en una búsqueda automática y ${TAIL}`;
    case 'orchestrator_error':
      return `${HEADER}ocurrió un error al usar las herramientas; esta respuesta se basa en una búsqueda automática y ${TAIL}`;
  }
}
