import { useEffect, useMemo, useState } from 'react'
import { Login, isLoggedIn, SESSION_KEY } from './Login'

const STORAGE_KEY = 'ledger-entries-v3'
const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

const defaultEntries = []

function toDateKey(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isWithinDateRange(value, from, to) {
  if (!from && !to) return true
  const dateKey = toDateKey(value)
  if (!dateKey) return false
  if (from && dateKey < from) return false
  if (to && dateKey > to) return false
  return true
}

function isMatchingMonthYear(value, month, year) {
  const dateKey = toDateKey(value)
  if (!dateKey) return false
  const dateYear = dateKey.slice(0, 4)
  const dateMonth = dateKey.slice(5, 7)
  if (month && dateMonth !== month) return false
  if (year && dateYear !== year) return false
  return true
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

function readFilesAsDataUrls(fileList) {
  return Promise.all(
    fileList.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve({ name: file.name, data: e.target?.result || '' })
          reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
          reader.readAsDataURL(file)
        }),
    ),
  )
}

function formatDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  const day = String(parsed.getDate()).padStart(2, '0')
  const month = parsed.toLocaleString('en-US', { month: 'short' })
  const year = parsed.getFullYear()

  const hour12 = parsed.getHours() % 12 || 12
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  const meridiem = parsed.getHours() >= 12 ? 'PM' : 'AM'

  return `${day}-${month}-${year} ${hour12}:${minutes} ${meridiem}`
}

function App() {
  const [loggedIn, setLoggedIn] = useState(() => isLoggedIn())

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY)
    setLoggedIn(false)
  }

  return <Ledger onLogout={handleLogout} />
}

function Ledger({ onLogout }) {
  const [entries, setEntries] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultEntries
    try {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? parsed : defaultEntries
    } catch {
      return defaultEntries
    }
  })

  const [form, setForm] = useState({
    name: '',
    work: '',
    date: '',
    credit: '',
    debit: '',
    remarks: '',
    attachments: [],
  })
  const [searchText, setSearchText] = useState('')
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)
  const [view, setView] = useState('list')
  const [selectedClient, setSelectedClient] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [historySearchText, setHistorySearchText] = useState('')
  const [listDateFrom, setListDateFrom] = useState('')
  const [listDateTo, setListDateTo] = useState('')
  const [listMonth, setListMonth] = useState('')
  const [listYear, setListYear] = useState('')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [historyMonth, setHistoryMonth] = useState('')
  const [historyYear, setHistoryYear] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  }, [entries])

  const rowsWithBalance = useMemo(() => {
    let runningBalance = 0
    return entries.map((entry, index) => {
      const credit = Number(entry.credit) || 0
      const debit = Number(entry.debit) || 0
      const attachments = normalizeAttachments(entry)
      runningBalance += credit - debit
      return {
        ...entry,
        slNo: index + 1,
        date: entry.date || '',
        credit,
        debit,
        attachments,
        attachmentNames: attachments.map((item) => item.name).join(' '),
        balance: runningBalance,
      }
    })
  }, [entries])

  const totals = useMemo(() => {
    return rowsWithBalance.reduce(
      (acc, row) => {
        acc.credit += row.credit
        acc.debit += row.debit
        acc.balance = row.balance
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [rowsWithBalance])

  const yearOptions = useMemo(() => {
    const years = new Set()
    years.add(String(new Date().getFullYear()))

    entries.forEach((entry) => {
      const dateKey = toDateKey(entry.date)
      if (dateKey) years.add(dateKey.slice(0, 4))
    })

    return Array.from(years).sort((a, b) => Number(b) - Number(a))
  }, [entries])

  const dateFilteredRows = useMemo(() => {
    return rowsWithBalance.filter(
      (row) =>
        isWithinDateRange(row.date, listDateFrom, listDateTo) &&
        isMatchingMonthYear(row.date, listMonth, listYear),
    )
  }, [rowsWithBalance, listDateFrom, listDateTo, listMonth, listYear])

  const filteredRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return dateFilteredRows

    return dateFilteredRows.filter((row) => {
      return [
        row.slNo,
        row.name,
        row.work,
        row.credit,
        row.debit,
        row.balance,
        row.remarks,
        row.attachmentNames,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [dateFilteredRows, searchText])

  const historyRows = useMemo(() => {
    const target = selectedClient.trim().toLowerCase()
    if (!target) return []

    const matchedEntries = entries.filter((entry) => entry.name.trim().toLowerCase() === target)
    const dateFilteredEntries = matchedEntries.filter((entry) =>
      isWithinDateRange(entry.date, historyDateFrom, historyDateTo) &&
      isMatchingMonthYear(entry.date, historyMonth, historyYear),
    )

    let runningBalance = 0
    return dateFilteredEntries
      .map((entry, index) => {
        const credit = Number(entry.credit) || 0
        const debit = Number(entry.debit) || 0
        runningBalance += credit - debit
        return {
          ...entry,
          slNo: index + 1,
          credit,
          debit,
          balance: runningBalance,
        }
      })
  }, [entries, selectedClient, historyDateFrom, historyDateTo, historyMonth, historyYear])

  const filteredHistoryRows = useMemo(() => {
    const keyword = historySearchText.trim().toLowerCase()
    if (!keyword) return historyRows

    return historyRows.filter((row) => {
      return [
        row.slNo,
        row.work,
        row.date,
        row.credit,
        row.debit,
        row.balance,
        row.remarks,
        row.attachmentNames,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [historyRows, historySearchText])

  const historyTotals = useMemo(() => {
    return filteredHistoryRows.reduce(
      (acc, row) => {
        acc.credit += row.credit
        acc.debit += row.debit
        acc.balance = row.balance
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [filteredHistoryRows])

  const filteredTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.credit += row.credit
        acc.debit += row.debit
        acc.balance = row.balance
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [filteredRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))
  const pageStartIndex = (currentPage - 1) * rowsPerPage
  const paginatedRows = filteredRows.slice(pageStartIndex, pageStartIndex + rowsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchText, rowsPerPage, listDateFrom, listDateTo, listMonth, listYear])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  async function handleChange(event) {
    const { name, value, files } = event.target
    if (name === 'file') {
      const pickedFiles = Array.from(files || [])
      if (!pickedFiles.length) {
        setForm((prev) => ({ ...prev, attachments: [] }))
        return
      }

      try {
        const uploaded = await readFilesAsDataUrls(pickedFiles)
        setForm((prev) => ({ ...prev, attachments: uploaded }))
      } catch {
        setForm((prev) => ({ ...prev, attachments: [] }))
      }
    } else {
      setForm((prev) => ({ ...prev, [name]: value }))
    }
  }

  function resetForm(keepName = '') {
    setForm({
      name: keepName,
      work: '',
      date: '',
      credit: '',
      debit: '',
      remarks: '',
      attachments: [],
    })
  }

  function openAddView(prefillName = '') {
    setEditingId(null)
    resetForm(prefillName)
    setView('add')
  }

  function handleOpenHistory(name) {
    setSelectedClient(name)
    setHistorySearchText('')
    setHistoryDateFrom('')
    setHistoryDateTo('')
    setHistoryMonth('')
    setHistoryYear('')
    setView('history')
  }

  function handleEditEntry(row) {
    const dateInput = row.date ? new Date(row.date).toISOString().slice(0, 10) : ''
    setForm({
      name: row.name || '',
      work: row.work || '',
      date: dateInput,
      credit: '',
      debit: '',
      remarks: row.remarks || '',
      attachments: row.attachments || [],
    })
    setEditingId(row.id)
    setView('add')
  }

  function handleAddEntry(event) {
    event.preventDefault()

    const credit = Number(form.credit) || 0
    const debit = Number(form.debit) || 0

    if (!form.name.trim() || !form.work.trim()) {
      return
    }

    const dateValue = form.date
      ? new Date(`${form.date}T00:00:00`).toISOString()
      : new Date().toISOString()

    const nextEntry = {
      id: editingId || Date.now(),
      name: form.name.trim(),
      work: form.work.trim(),
      date: dateValue,
      credit,
      debit,
      remarks: form.remarks.trim(),
      attachments: form.attachments,
      // Keep legacy fields for old UI/data compatibility.
      file: form.attachments[0]?.data || null,
      fileName: form.attachments[0]?.name || '',
    }

    if (editingId) {
      const original = entries.find((entry) => entry.id === editingId)
      const originalCredit = Number(original?.credit) || 0
      const originalDebit = Number(original?.debit) || 0
      const amountChanged = originalCredit !== credit || originalDebit !== debit

      if (amountChanged) {
        // Keep old transaction immutable and record new amount as a new transaction entry.
        setEntries((prev) => [...prev, { ...nextEntry, id: Date.now() }])
      } else {
        setEntries((prev) => prev.map((entry) => (entry.id === editingId ? nextEntry : entry)))
      }
    } else {
      setEntries((prev) => [...prev, nextEntry])
      if (!searchText.trim()) {
        setCurrentPage(Math.ceil((entries.length + 1) / rowsPerPage))
      }
    }

    setEditingId(null)
    resetForm()
    setView('list')
  }

  return (
    <main className="app-shell">
      <section className="card">
        <header className="app-header">
          <img src="/logo.svg" alt="Ledger logo" className="app-logo" />
          <div className="app-header-text">
            <h1>Ledger</h1>
            <p className="app-tagline">Track Credits &amp; Debits</p>
          </div>
          <button type="button" className="logout-btn" onClick={onLogout}>Logout</button>
        </header>

        {view === 'add' ? (
          <>
            <div className="page-title-bar">
              <button type="button" className="ghost back-btn" onClick={() => { setEditingId(null); resetForm(); setView('list') }}>
                ← Back
              </button>
              <h2 className="page-title">{editingId ? 'Edit Ledger' : 'Add New Ledger'}</h2>
            </div>

            <form className="entry-form" onSubmit={handleAddEntry}>
              <input
                name="name"
                placeholder="Name"
                value={form.name}
                onChange={handleChange}
                required
              />
              <input
                name="work"
                placeholder="Work"
                value={form.work}
                onChange={handleChange}
                required
              />
              <input
                name="credit"
                type="number"
                min="0"
                placeholder="Credit"
                value={form.credit}
                onChange={handleChange}
              />
              <input
                name="debit"
                type="number"
                min="0"
                placeholder="Debit"
                value={form.debit}
                onChange={handleChange}
              />
              <label className="date-field">
                Date
                <input
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={handleChange}
                />
              </label>
              <textarea
                name="remarks"
                placeholder="Remarks (optional)"
                value={form.remarks}
                onChange={handleChange}
                rows={2}
                style={{ gridColumn: 'span 2', resize: 'vertical' }}
              />
              <label className="date-field" style={{ gridColumn: 'span 2' }}>
                Attachment (optional)
                <input
                  name="file"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={handleChange}
                />
                {form.attachments.length > 0 && (
                  <>
                    <span className="file-name-hint">{form.attachments.length} file(s) selected</span>
                    <span className="file-name-list">{form.attachments.map((item) => item.name).join(', ')}</span>
                  </>
                )}
              </label>
              <button type="submit" style={{ gridColumn: 'span 2' }}>{editingId ? 'Update Ledger' : 'Save Ledger'}</button>
            </form>
          </>
        ) : view === 'history' ? (
          <>
            <div className="page-title-bar">
              <button
                type="button"
                className="ghost back-btn"
                onClick={() => {
                  setSelectedClient('')
                  setHistorySearchText('')
                  setHistoryDateFrom('')
                  setHistoryDateTo('')
                  setHistoryMonth('')
                  setHistoryYear('')
                  setView('list')
                }}
              >
                ← Back
              </button>
              <h2 className="page-title">{selectedClient} History</h2>
            </div>

            <p className="history-meta">
              Total Transactions: <strong>{filteredHistoryRows.length}</strong> | Credit: <strong>{historyTotals.credit}</strong> | Debit:{' '}
              <strong>{historyTotals.debit}</strong> | Balance: <strong>{historyTotals.balance}</strong>
            </p>

            <div className="history-toolbar">
              <input
                aria-label="Search history rows"
                className="search-input"
                type="search"
                placeholder="Search history by work, amount, remarks..."
                value={historySearchText}
                onChange={(event) => setHistorySearchText(event.target.value)}
              />
              <div className="date-range-row">
                <label className="filter-field" htmlFor="history-date-from">
                  From
                  <input
                    id="history-date-from"
                    type="date"
                    value={historyDateFrom}
                    onChange={(event) => setHistoryDateFrom(event.target.value)}
                  />
                </label>
                <label className="filter-field" htmlFor="history-date-to">
                  To
                  <input
                    id="history-date-to"
                    type="date"
                    value={historyDateTo}
                    onChange={(event) => setHistoryDateTo(event.target.value)}
                  />
                </label>
              </div>
              <div className="month-year-row">
                <label className="filter-field" htmlFor="history-month">
                  Month
                  <select
                    id="history-month"
                    value={historyMonth}
                    onChange={(event) => setHistoryMonth(event.target.value)}
                  >
                    <option value="">All Months</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field" htmlFor="history-year">
                  Year
                  <select
                    id="history-year"
                    value={historyYear}
                    onChange={(event) => setHistoryYear(event.target.value)}
                  >
                    <option value="">All Years</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sl No</th>
                    <th>Work</th>
                    <th>Date</th>
                    <th>Credit</th>
                    <th>Debit</th>
                    <th>Balance</th>
                    <th>Remarks</th>
                    <th>Attachment</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistoryRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Sl No">{row.slNo}</td>
                      <td data-label="Work">{row.work}</td>
                      <td data-label="Date">{formatDateTime(row.date)}</td>
                      <td data-label="Credit">{row.credit}</td>
                      <td data-label="Debit">{row.debit}</td>
                      <td data-label="Balance">{row.balance}</td>
                      <td data-label="Remarks">{row.remarks || '-'}</td>
                      <td data-label="Attachment">
                        {row.attachments.length > 0 ? (
                          <div className="attachment-list">
                            {row.attachments.map((item) => (
                              <a
                                key={`${row.id}-${item.name}`}
                                href={item.data}
                                download={item.name}
                                className="file-download-link"
                              >
                                📎 {item.name}
                              </a>
                            ))}
                          </div>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                  {filteredHistoryRows.length === 0 && (
                    <tr>
                      <td colSpan="8">No history for this client</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="list-actions">
              <button type="button" className="add-new-btn" onClick={() => openAddView()}>
                + Add New
              </button>
            </div>

            <div className="list-toolbar">
              <input
                aria-label="Search ledger rows"
                className="search-input"
                type="search"
                placeholder="Search by name, work, amount..."
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
              <div className="date-range-row">
                <label className="filter-field" htmlFor="list-date-from">
                  From
                  <input
                    id="list-date-from"
                    type="date"
                    value={listDateFrom}
                    onChange={(event) => setListDateFrom(event.target.value)}
                  />
                </label>
                <label className="filter-field" htmlFor="list-date-to">
                  To
                  <input
                    id="list-date-to"
                    type="date"
                    value={listDateTo}
                    onChange={(event) => setListDateTo(event.target.value)}
                  />
                </label>
              </div>
              <div className="month-year-row">
                <label className="filter-field" htmlFor="list-month">
                  Month
                  <select
                    id="list-month"
                    value={listMonth}
                    onChange={(event) => setListMonth(event.target.value)}
                  >
                    <option value="">All Months</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field" htmlFor="list-year">
                  Year
                  <select
                    id="list-year"
                    value={listYear}
                    onChange={(event) => setListYear(event.target.value)}
                  >
                    <option value="">All Years</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sl No</th>
                    <th>Name</th>
                    <th>Work</th>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Sl No">{row.slNo}</td>
                      <td data-label="Name">{row.name}</td>
                      <td data-label="Work">{row.work}</td>
                      <td data-label="Date">{formatDateTime(row.date)}</td>
                      <td data-label="Amount">{row.balance}</td>
                      <td data-label="Action" className="actions-cell">
                        <div className="actions-wrap">
                          <button
                            type="button"
                            className="ghost table-action-btn"
                            onClick={() => handleOpenHistory(row.name)}
                          >
                            History
                          </button>
                          <button
                            type="button"
                            className="table-action-btn"
                            onClick={() => handleEditEntry(row)}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedRows.length === 0 && (
                    <tr>
                      <td colSpan="6">No ledgers</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan="4">Total</th>
                    <th>{searchText ? filteredTotals.balance : totals.balance}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="pagination-toolbar">
              <label htmlFor="rows-per-page">per page</label>
              <select
                id="rows-per-page"
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(Number(event.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                className="ghost"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </>
        )}

        <footer className="app-footer">
          <p className="app-footer-primary">&copy; {new Date().getFullYear()} Ledger App. All rights reserved.</p>
          <p className="app-footer-secondary">Developed by <strong>Ajith Reddy</strong></p>
        </footer>
      </section>
    </main>
  )
}

export default App
