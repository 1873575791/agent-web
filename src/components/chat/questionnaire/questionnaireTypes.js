/**
 * @typedef {Object} QuestionnaireField
 * @property {string} id
 * @property {string} label
 * @property {string} [emoji]
 * @property {'choice'|'multi'|'text'} type
 * @property {string[]} options
 * @property {boolean} allowCustom
 * @property {string} [placeholder]
 * @property {boolean} [required]
 */

/**
 * @typedef {Object} AgentQuestionnaireSpec
 * @property {1} v
 * @property {string} title
 * @property {string} [description]
 * @property {string} [submitLabel]
 * @property {QuestionnaireField[]} fields
 */

export {};
