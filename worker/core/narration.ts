// 修補模型偶發的未完成句尾；responseSchema 上線後若不再出現可整段移除。
export function completeAbruptNarration(paragraph: string) {
  const hasTrailingEllipsis = /[.．。…⋯]{2,}\s*$/.test(paragraph)
  const stem = paragraph.replace(/[\s.．。…⋯]+$/g, '').trim()

  if (!stem) {
    return paragraph
  }

  const hasWeakSemanticEnding =
    /(?:一陣|一股|一聲|一道|一片|一種|某種|幾個|幾道|幾聲|什麼|某件|某個|某些|像是|彷彿|似乎|變得|顯得|開始|再度|突然|逐漸|慢慢|依然|仍然)$/.test(
      stem,
    )

  if (!hasTrailingEllipsis && !hasWeakSemanticEnding) {
    return paragraph
  }

  if (/遇上了$/.test(stem)) {
    return `${stem}某件難以明說的事，後面的字句像被雨聲與訊號一同吞沒。`
  }

  if (/(?:一陣|一股)$/.test(stem)) {
    return `${stem}濕冷而難以分辨的氣息，短暫擦過你的感官後又沉回雨聲裡。`
  }

  if (/(?:一聲|幾聲)$/.test(stem)) {
    return `${stem}模糊的聲響，像從建築深處傳來，又很快被雨水蓋過。`
  }

  if (/(?:一道|幾道|一片)$/.test(stem)) {
    return `${stem}無法確定來源的陰影，在昏暗光線裡很快失去輪廓。`
  }

  if (/(?:一種|某種|什麼|某件|某個|某些)$/.test(stem)) {
    return `${stem}你暫時無法命名的不協調感；它沒有給出答案，只讓現場變得更難以忽視。`
  }

  if (/(?:提到|寫著|顯示|說|表示|要求|看見|聽見|發現)$/.test(stem)) {
    return `${stem}一段還來不及完整辨認的內容；你只能先把它當成不安的提示，繼續確認眼前可見的線索。`
  }

  return `${stem}。`
}
