/* eslint-disable no-console */
import dedent from 'dedent'
import OpenAI from 'openai'
import { encoding_for_model } from 'tiktoken'
import z from 'zod'

export const getChatGptTextRequestPrice = ({
  promptTokensCount,
  completionTokensCount,
  chatGptModel,
}: {
  promptTokensCount: number
  completionTokensCount: number
  chatGptModel: 'gpt-4-turbo'
}) => {
  const pricePer1kInputTokens = {
    'gpt-4-turbo': 0.00008,
  }[chatGptModel]
  const pricePer1kOutputTokens = {
    'gpt-4-turbo': 0.00008,
  }[chatGptModel]
  return (promptTokensCount * pricePer1kInputTokens + completionTokensCount * pricePer1kOutputTokens) / 1000
}

export const getChatGptModelTokensLimit = (chatGptModel: 'gpt-4-turbo') => {
  return {
    'gpt-4-turbo': 128000,
  }[chatGptModel]
}

export const getTokensCount = ({ text, chatGptModel }: { text: string; chatGptModel: 'gpt-4-turbo' }) => {
  const enc = encoding_for_model(chatGptModel)
  return enc.encode(text).length
}

export const translateWithOpenai = async ({
  srcLang,
  distLang,
  flatSrcContent,
  flatDistContent,
  notTranslatedKeys,
  openaiApiKey,
  showOldDistData = false,
  showNotChangedData = false,
  verbose = false,
}: {
  srcLang: string
  distLang: string
  flatSrcContent: Record<string, string>
  flatDistContent: Record<string, string>
  notTranslatedKeys: string[]
  showOldDistData?: boolean
  showNotChangedData?: boolean
  openaiApiKey?: string
  verbose?: boolean
}) => {
  openaiApiKey = openaiApiKey || process?.env?.OPENAI_API_KEY
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not defined')
  }
  const openai = new OpenAI({
    apiKey: openaiApiKey,
  })
  const chatGptModel = 'gpt-4-turbo'
  if (!notTranslatedKeys.length) {
    return { updatedFlatDistContent: flatDistContent, requestContent: '', price: 0 }
  }

  const flatSrcContentSuitable = showNotChangedData
    ? flatSrcContent
    : Object.fromEntries(Object.entries(flatSrcContent).filter(([key]) => notTranslatedKeys.includes(key)))
  const originalContentPart = dedent`
    New original content, language ${srcLang}:
    ${Object.entries(flatSrcContentSuitable)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')}
  `

  const flatDistContentSuitable = showNotChangedData
    ? flatDistContent
    : Object.fromEntries(Object.entries(flatDistContent).filter(([key]) => notTranslatedKeys.includes(key)))
  const translatedContentPart =
    !showOldDistData || !Object.entries(flatDistContentSuitable).length
      ? null
      : dedent`
    Previously translated content, language ${distLang}:
    ${Object.entries(flatDistContentSuitable)
      .filter(([key]) => showNotChangedData || notTranslatedKeys.includes(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')}
  `
  const taskContentPart = dedent`
    Give me fresh translations for keys from ${srcLang} language to ${distLang} language:
    ${notTranslatedKeys.join('\n')}
  `
  const requestContent = [originalContentPart, translatedContentPart, taskContentPart].filter(Boolean).join('\n\n')
  if (verbose) {
    console.info('Request content:')
    console.info(requestContent)
  }
  const res = await openai.chat.completions.create({
    model: chatGptModel,
    messages: [
      {
        role: 'system',
        content: `You are a translater. You should translate the content from ${srcLang} to ${distLang}. Whenever you call any function, you should pass already translated arguments.`,
      },
      {
        role: 'user',
        content: requestContent,
      },
    ],
    function_call: { name: 'finishTranslation' },
    functions: [
      {
        name: 'finishTranslation',
        description: `Finish translation the content from ${srcLang} to ${distLang}. This function should be called with already translated content to language ${distLang}.`,
        parameters: {
          type: 'object',
          properties: {
            ...notTranslatedKeys.reduce(
              (acc, key) => {
                acc[key] = { type: 'string' }
                return acc
              },
              {} as Record<string, { type: string }>
            ),
          },
          required: notTranslatedKeys,
        },
      },
    ],
  })
  const promptTokensCount = res.usage?.prompt_tokens || 0
  const completionTokensCount = res.usage?.completion_tokens || 0
  const price = getChatGptTextRequestPrice({ chatGptModel, promptTokensCount, completionTokensCount })
  const serializedFnArguments = (res.choices[0].message as any)?.function_call?.arguments
  const parsedFnArguments = (() => {
    try {
      return JSON.parse(serializedFnArguments)
    } catch (error: any) {
      throw new Error(`Failed to parse function arguments: ${serializedFnArguments}`)
    }
  })()
  const parsedFnArgumentsValidationResult = z.record(z.string()).safeParse(parsedFnArguments)
  if (parsedFnArgumentsValidationResult.success === false) {
    throw new Error(`Function arguments are not valid: ${JSON.stringify(parsedFnArguments)}`)
  }
  const safeFnArguments = parsedFnArgumentsValidationResult.data
  const updatedFlatDistContent: Record<string, string> = {}
  for (const [key, value] of Object.entries(flatDistContent)) {
    updatedFlatDistContent[key] = value
  }
  for (const [key, value] of Object.entries(safeFnArguments)) {
    if (notTranslatedKeys.includes(key)) {
      updatedFlatDistContent[key] = value
    }
  }
  return { updatedFlatDistContent, requestContent, price }
}
