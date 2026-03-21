function toIsoDateOrNow(value) {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function normalizeAttachments(entry) {
  if (Array.isArray(entry.attachments) && entry.attachments.length > 0) {
    return entry.attachments
      .filter((item) => item && item.name && item.data)
      .map((item) => ({ name: item.name, data: item.data }))
  }

  if (entry.file && entry.fileName) {
    return [{ name: entry.fileName, data: entry.file }]
  }

  return []
}

export function buildHistoryRows({
  entries,
  selectedClient,
  historyDateFrom,
  historyDateTo,
  historyMonth,
  historyYear,
  isWithinDateRange,
  isMatchingMonthYear,
}) {
  const target = selectedClient.trim().toLowerCase()
  if (!target) return []

  const matchedEntries = entries.filter((entry) => entry.name.trim().toLowerCase() === target)
  const dateFilteredEntries = matchedEntries.filter((entry) =>
    isWithinDateRange(entry.date, historyDateFrom, historyDateTo) &&
    isMatchingMonthYear(entry.date, historyMonth, historyYear),
  )

  const sortedEntries = [...dateFilteredEntries].sort((a, b) => {
    const aDate = new Date(toIsoDateOrNow(a.date)).getTime()
    const bDate = new Date(toIsoDateOrNow(b.date)).getTime()
    if (aDate !== bDate) return aDate - bDate
    return String(a.id).localeCompare(String(b.id))
  })

  let runningBalance = 0
  return sortedEntries.map((entry, index) => {
    const credit = Number(entry.credit) || 0
    const debit = Number(entry.debit) || 0
    const attachments = normalizeAttachments(entry)
    runningBalance += credit - debit

    return {
      ...entry,
      slNo: index + 1,
      date: toIsoDateOrNow(entry.date),
      credit,
      debit,
      attachments,
      attachmentNames: attachments.map((item) => item.name).join(' '),
      balance: runningBalance,
    }
  })
}
