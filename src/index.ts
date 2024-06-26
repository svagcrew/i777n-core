import { translateWithOpenai } from '@/lib/openai.js'
import _ from 'lodash'
import { deepMap } from 'svag-deep-map'
import z from 'zod'

export const i777LangsCodes = [
  'en',
  'ru',
  'de',
  'fr',
  'es',
  'it',
  'ja',
  'ko',
  'zh',
  'pt',
  'nl',
  'pl',
  'tr',
  'ar',
  'th',
  'vi',
  'he',
  'id',
  'uk',
  'ro',
  'cs',
  'el',
  'hu',
  'sv',
  'da',
  'fi',
  'sk',
  'no',
  'hi',
  'bn',
  'ms',
  'ta',
  'te',
  'ml',
  'mr',
  'kn',
  'gu',
  'pa',
  'or',
  'as',
  'ne',
  'si',
  'my',
  'km',
  'lo',
  'am',
  'ti',
  'fa',
  'ps',
  'ku',
  'sd',
  'bo',
  'dz',
  'ug',
  'mn',
  'my',
  'ka',
  'hy',
  'az',
] as const
export const zI777LangCode = z.enum(i777LangsCodes)
export type I777LangCode = z.infer<typeof zI777LangCode>

export const zI777MetaItem = z.object({
  srcLang: zI777LangCode,
  srcValue: z.string(),
  distLang: zI777LangCode,
  distValue: z.string().nullable(),
})
export const zI777Meta = z.record(zI777MetaItem)
export type I777MetaItem = z.infer<typeof zI777MetaItem>
export type I777Meta = Record<string, I777MetaItem>
export type I777InfoItem = I777MetaItem & {
  actual: boolean
  currentSrcValue: string
}
export type I777Info = Record<string, I777InfoItem>

export const getClearI777Meta = ({
  srcLang,
  distLangs,
  content,
}: {
  srcLang: I777LangCode
  distLangs: I777LangCode[]
  content: Record<string, any>
}) => {
  const meta: I777Meta = {}
  for (const lang of distLangs) {
    deepMap(content, ({ path, value }) => {
      const valueString = typeof value === 'string' ? value : typeof value === 'number' ? value.toString() : null
      if (valueString) {
        meta[`${lang}.${path}`] = {
          srcLang,
          srcValue: valueString,
          distLang: lang,
          distValue: lang === srcLang ? valueString : null,
        }
      }
      return value
    })
  }
  return { meta }
}

export const normalizeI777Meta = ({
  metaSource,
  srcLang,
  distLangs,
  content,
}: {
  metaSource: I777Meta
  srcLang: I777LangCode
  distLangs: I777LangCode[]
  content: Record<string, any>
}) => {
  const metaCleared = Object.fromEntries(
    Object.entries(metaSource).filter(([, value]) => value.distValue && value.srcValue)
  )
  const metaValid = zI777Meta.parse(metaCleared)
  const { meta: metaNormalized } = getClearI777Meta({ srcLang, distLangs, content })
  for (const key of Object.keys(metaNormalized)) {
    if (metaValid[key]) {
      metaNormalized[key] = metaValid[key]
    }
  }
  return { meta: metaNormalized }
}

export const getI777Info = ({
  meta,
  content,
  srcLang,
}: {
  meta: I777Meta
  content: Record<string, any>
  srcLang: I777LangCode
}) => {
  const info: I777Info = {}
  for (const [metaKey, metaValue] of Object.entries(meta)) {
    const contentPath = metaKey.split('.').slice(1).join('.')
    const currentSrcValue = _.get(content, contentPath)
    const actual = metaValue.srcValue === currentSrcValue && !!metaValue.distValue && metaValue.srcLang === srcLang
    info[metaKey] = {
      ...meta[metaKey],
      currentSrcValue,
      actual,
    }
  }
  return { info }
}

export const getI777InfoForLang = ({ info, lang }: { info: I777Info; lang: string }) => {
  return _.pickBy(info, (value) => value.distLang === lang)
}

export const getFlatI777ContentByI777Meta = ({ meta, lang }: { meta: I777Meta; lang: string }) => {
  const flatContent: Record<string, string> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (value.distLang === lang && value.distValue) {
      flatContent[key.split('.').slice(1).join('.')] = value.distValue
    }
  }
  return { flatContent }
}

export const getFlatI777ContentByI777Content = ({ content }: { content: Record<string, any> }) => {
  const flatContent: Record<string, string> = {}
  deepMap(content, ({ path, value }) => {
    const valueString = typeof value === 'string' ? value : typeof value === 'number' ? value.toString() : null
    if (valueString) {
      flatContent[path] = valueString
    }
    return value
  })
  return { flatContent }
}

export const flatI777ContentToI777Content = ({ flatContent }: { flatContent: Record<string, string> }) => {
  const content: Record<string, any> = {}
  for (const [path, value] of Object.entries(flatContent)) {
    _.set(content, path, value)
  }
  return { content }
}

export const getNotTranslatedKeysByI777Info = ({ info, lang }: { info: I777Info; lang?: I777LangCode }) => {
  const notTranslatedKeys = Object.entries(info)
    .filter(([, value]) => {
      return !value.actual && (!lang || value.distLang === lang)
    })
    .map(([keyWithLang]) => keyWithLang.split('.').slice(1).join('.'))
  return { notTranslatedKeys }
}

export const getNotTranslatedLangsByI777Info = ({ info }: { info: I777Info }) => {
  const notTranslatedLangsNotUnique = Object.values(info)
    .filter((value) => !value.actual)
    .map((value) => value.distLang)
  const notTranslatedLangs = Array.from(new Set(notTranslatedLangsNotUnique))
  return { notTranslatedLangs }
}

export const isFullyTranslatedByI777Info = ({ info, lang }: { info: I777Info; lang?: I777LangCode }) => {
  return !getNotTranslatedKeysByI777Info({ info, lang }).notTranslatedKeys.length
}

export const check = async ({
  content,
  meta,
  srcLang,
  distLang,
}: {
  content: Record<string, any>
  meta: I777Meta
  srcLang: I777LangCode
  distLang: I777LangCode
}) => {
  if (srcLang === distLang) {
    return { willBeTranslated: false, notTranslatedKeys: [], message: 'Source and destination languages are the same' }
  }
  const { info } = getI777Info({ meta, content, srcLang })
  const { flatContent: flatSrcContent } = getFlatI777ContentByI777Content({ content })
  const { notTranslatedKeys } = getNotTranslatedKeysByI777Info({ info, lang: distLang })
  if (Object.keys(flatSrcContent).length === 0) {
    return { willBeTranslated: false, notTranslatedKeys, message: 'There are no keys in source content' }
  }
  if (!notTranslatedKeys.length) {
    return { willBeTranslated: false, notTranslatedKeys, message: 'There are no keys to translate' }
  }
  return { willBeTranslated: true, notTranslatedKeys, message: 'There are keys to translate' }
}

export const translate = async ({
  content,
  meta,
  srcLang,
  distLang,
  openaiApiKey,
}: {
  content: Record<string, any>
  meta: I777Meta
  srcLang: I777LangCode
  distLang: I777LangCode
  openaiApiKey?: string
}) => {
  const { meta: normalizedMeta } = normalizeI777Meta({
    metaSource: meta,
    distLangs: [distLang],
    srcLang,
    content,
  })
  if (srcLang === distLang) {
    return { content, meta: normalizedMeta, wasTranslated: false }
  }
  const { info } = getI777Info({ meta: normalizedMeta, content, srcLang })
  const { flatContent: flatSrcContent } = getFlatI777ContentByI777Content({ content })
  const { flatContent: flatDistContent } = getFlatI777ContentByI777Meta({ meta: normalizedMeta, lang: distLang })
  const { content: oldDistContent } = flatI777ContentToI777Content({
    flatContent: flatDistContent,
  })
  const { notTranslatedKeys } = getNotTranslatedKeysByI777Info({ info, lang: distLang })
  if (Object.keys(flatSrcContent).length === 0) {
    return {
      content: oldDistContent,
      meta: normalizedMeta,
      wasTranslated: false,
      message: 'There are no keys in source content',
    }
  }
  if (!notTranslatedKeys.length) {
    return {
      content: oldDistContent,
      meta: normalizedMeta,
      wasTranslated: false,
      message: 'There are no keys to translate',
    }
  }

  const { updatedFlatDistContent } = await translateWithOpenai({
    srcLang,
    distLang,
    flatSrcContent,
    flatDistContent,
    notTranslatedKeys,
    openaiApiKey,
  })
  const { content: distContent } = flatI777ContentToI777Content({
    flatContent: updatedFlatDistContent,
  })
  const distMeta = _.cloneDeep(normalizedMeta)
  for (const key of notTranslatedKeys) {
    const srcValue = flatSrcContent[key]
    const distValue = updatedFlatDistContent[key]
    if (!distValue || !srcValue) {
      continue
    }
    distMeta[`${distLang}.${key}`] = {
      srcLang,
      srcValue,
      distLang,
      distValue,
    }
  }
  return { content: distContent, meta: distMeta, wasTranslated: true }
}

export const fix = async ({
  srcContent,
  distContent,
  meta,
  srcLang,
  distLang,
}: {
  srcContent: Record<string, any>
  distContent: Record<string, any>
  meta: I777Meta
  srcLang: I777LangCode
  distLang: I777LangCode
}) => {
  const { flatContent: flatSrcContent } = getFlatI777ContentByI777Content({ content: srcContent })
  const { flatContent: flatDistContent } = getFlatI777ContentByI777Content({ content: distContent })
  const flatDistContentKeys = Object.keys(flatDistContent)
  const distMeta = _.cloneDeep(meta)
  for (const key of flatDistContentKeys) {
    const srcValue = flatSrcContent[key]
    const distValue = flatDistContent[key]
    if (!srcValue) {
      continue
    }
    distMeta[`${distLang}.${key}`] = {
      srcLang,
      srcValue,
      distLang,
      distValue,
    }
  }
  return { meta: distMeta }
}
