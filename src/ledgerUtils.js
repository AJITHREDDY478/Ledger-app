function toIsoDateOrNow(value) {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function normalizeAttachments(entry) {
  if (Array.isArray(entry.attachments) && entry.attachments.length > 0) {
    return entry.attachments
      .filter((item) => item && item.name && (item.url || item.data))
      .map((item) => ({ name: item.name, url: item.url || item.data }))
  }
  return []
}

export function buildHistoryRows({
  entries,
  selectedClient,
  historyMonth,
  historyYear,
  isMatchingMonthYear,
}) {
  const target = selectedClient.trim().toLowerCase()
  if (!target) return []

  const matchedEntries = entries.filter((entry) => {
    const entryName =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name : selectedClient
    return entryName.trim().toLowerCase() === target
  })
  const dateFilteredEntries = matchedEntries.filter((entry) =>
    isMatchingMonthYear(entry.date, historyMonth, historyYear),
  )

  const sortedEntries = [...dateFilteredEntries].sort((a, b) => {
    const aDate = new Date(toIsoDateOrNow(a.date)).getTime()
    const bDate = new Date(toIsoDateOrNow(b.date)).getTime()
    if (aDate !== bDate) return bDate - aDate
    return String(b.id).localeCompare(String(a.id))
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
