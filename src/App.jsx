import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { Login, isLoggedIn, SESSION_KEY } from './Login'
import { APP_CONFIG, supabase } from './config'
import { buildHistoryRows } from './ledgerUtils'
import { isDriveConfigured, uploadHtmlToDrive } from './googleDrive'

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
const MAX_ATTACHMENTS = 8
const MAX_IMAGE_DIMENSION = 1280
const IMAGE_COMPRESSION_QUALITY = 0.72
const MAX_INLINE_ATTACHMENT_BYTES = 900 * 1024

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function getTodayInputDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toIsoDateOrNow(value) {
  if (!value) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function getSessionUser() {
  try {
    const rawUser = sessionStorage.getItem('user')
    return rawUser ? JSON.parse(rawUser) : null
  } catch {
    return null
  }
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function formatFilePart(value) {
  return value.trim().replace(/\s+/g, '-').toLowerCase() || 'statement'
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0)
}

function formatAmount(value) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

function formatPdfCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

function toDateKey(value) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
      .filter((item) => item && item.name && (item.url || item.data))
      .map((item) => ({ name: item.name, url: item.url || item.data }))
  }
  return []
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function dataUrlByteSize(dataUrl) {
  const text = String(dataUrl || '')
  const marker = ';base64,'
  const markerIndex = text.indexOf(marker)
  if (markerIndex === -1) return text.length
  const base64 = text.slice(markerIndex + marker.length)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = dataUrl
  })
}

async function toOptimizedAttachmentData(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const originalDataUrl = await readFileAsDataUrl(file)

  if (!file.type.startsWith('image/')) {
    return { name: safeName, url: String(originalDataUrl || '') }
  }

  const image = await loadImageFromDataUrl(originalDataUrl)
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  if (!width || !height) {
    return { name: safeName, url: String(originalDataUrl || '') }
  }

  const ratio = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * ratio))
  const targetHeight = Math.max(1, Math.round(height * ratio))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { name: safeName, url: String(originalDataUrl || '') }
  }
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  const optimizedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_COMPRESSION_QUALITY)
  const optimized =
    dataUrlByteSize(optimizedDataUrl) < dataUrlByteSize(originalDataUrl)
      ? optimizedDataUrl
      : originalDataUrl
  return { name: safeName, url: optimized }
}

async function convertFilesToInlineAttachments(fileList) {
  const attachments = await Promise.all(
    fileList.map(async (file) => toOptimizedAttachmentData(file)),
  )
  return attachments
    .filter((item) => item.url)
    .map((item) => {
      if (dataUrlByteSize(item.url) > MAX_INLINE_ATTACHMENT_BYTES) {
        throw new Error(`"${item.name}" is too large. Please use a smaller image.`)
      }
      return item
    })
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

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  )
}

function buildBackupHtml(data) {
  const json = JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>')
  const title = `${data.app} Backup`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { --line:#e5e7eb; --muted:#64748b; --text:#0f172a; --bg:#f8fafc; --card:#fff; }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);}
  .shell{max-width:1100px;margin:0 auto;padding:20px;}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04);}
  header h1{margin:0 0 4px;font-size:22px}
  .tag{color:var(--muted);font-size:13px;margin:0}
  .meta{display:flex;flex-wrap:wrap;gap:14px;margin:14px 0 18px;font-size:12px;color:var(--muted)}
  .meta b{color:var(--text)}
  .summary-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
  .sc{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:#fafafa}
  .sc span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .sc strong{font-size:16px}
  .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
  .toolbar input{flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-weight:600}
  tr.clickable{cursor:pointer}
  tr.clickable:hover{background:#f8fafc}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .pos{color:#15803d}.neg{color:#b91c1c}
  .back{display:inline-block;margin-bottom:10px;background:none;border:1px solid var(--line);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px}
  .back:hover{background:#f1f5f9}
  .hidden{display:none}
  h2{margin:0 0 10px;font-size:18px}
  .att{display:block;font-size:11px;color:var(--muted)}
  footer{margin-top:14px;font-size:11px;color:var(--muted);text-align:center}
  @media print { .toolbar,.back,.hide-print{display:none!important} body{background:#fff} .card{border:0;box-shadow:none} }
</style>
</head>
<body>
<div class="shell">
  <div class="card">
    <header>
      <h1 id="app-title"></h1>
      <p class="tag" id="app-tag"></p>
      <div class="meta">
        <span>Exported: <b id="exported-at"></b></span>
        <span>By: <b id="exported-by"></b></span>
        <span>Ledgers: <b id="t-ledgers"></b></span>
        <span>Transactions: <b id="t-txns"></b></span>
        <span>Net Balance: <b id="t-balance"></b></span>
      </div>
    </header>

    <section id="list-view">
      <div class="summary-cards">
        <div class="sc"><span>Ledgers</span><strong id="sc-ledgers">0</strong></div>
        <div class="sc"><span>Transactions</span><strong id="sc-txns">0</strong></div>
        <div class="sc"><span>Net Balance</span><strong id="sc-balance">0</strong></div>
      </div>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search by name, work..." />
      </div>
      <table>
        <thead><tr>
          <th>Sl No</th><th>Name</th><th>Last Work</th><th>Count</th><th>Last Date</th><th class="num">Balance (Rs)</th>
        </tr></thead>
        <tbody id="list-body"></tbody>
      </table>
    </section>

    <section id="history-view" class="hidden">
      <button class="back" id="btn-back">&larr; Back</button>
      <h2 id="h-name"></h2>
      <div class="summary-cards">
        <div class="sc"><span>Credit</span><strong id="h-credit">0</strong></div>
        <div class="sc"><span>Debit</span><strong id="h-debit">0</strong></div>
        <div class="sc"><span>Balance</span><strong id="h-balance">0</strong></div>
      </div>
      <table>
        <thead><tr>
          <th>Sl No</th><th>Date</th><th>Work</th><th class="num">Credit (Rs)</th><th class="num">Debit (Rs)</th><th class="num">Balance (Rs)</th><th>Remarks</th>
        </tr></thead>
        <tbody id="history-body"></tbody>
      </table>
    </section>

    <footer class="hide-print">Self-contained snapshot \u2014 open this file directly in a browser.</footer>
  </div>
</div>

<script id="ledger-data" type="application/json">${json}</script>
<script>
(function(){
  var DATA = JSON.parse(document.getElementById('ledger-data').textContent);
  var inr = new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  function fmt(n){ n = Number(n)||0; return inr.format(n); }
  function fmtDate(v){
    if(!v) return '-';
    var d = new Date(v); if(isNaN(d.getTime())) return v;
    var dd=String(d.getDate()).padStart(2,'0');
    var mo=d.toLocaleString('en-US',{month:'short'});
    var yy=d.getFullYear();
    var h=d.getHours()%12||12;
    var mm=String(d.getMinutes()).padStart(2,'0');
    var ap=d.getHours()>=12?'PM':'AM';
    return dd+'-'+mo+'-'+yy+' '+h+':'+mm+' '+ap;
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function balCls(n){ return Number(n)>=0?'pos':'neg'; }

  document.getElementById('app-title').textContent = DATA.app + ' Backup';
  document.getElementById('app-tag').textContent = DATA.tagline || '';
  document.getElementById('exported-at').textContent = fmtDate(DATA.exportedAt);
  document.getElementById('exported-by').textContent = DATA.exportedBy || '-';
  document.getElementById('t-ledgers').textContent = DATA.totalLedgers;
  document.getElementById('t-txns').textContent = DATA.totalTxns;
  document.getElementById('t-balance').textContent = fmt(DATA.totalBalance);
  document.getElementById('sc-ledgers').textContent = DATA.totalLedgers;
  document.getElementById('sc-txns').textContent = DATA.totalTxns;
  document.getElementById('sc-balance').textContent = fmt(DATA.totalBalance);

  var listBody = document.getElementById('list-body');
  var search = document.getElementById('search');

  function renderList(filter){
    var q = (filter||'').trim().toLowerCase();
    var rows = DATA.summary.filter(function(r){
      if(!q) return true;
      return [r.name, r.lastWork, r.balance, r.txCount].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    listBody.innerHTML = rows.map(function(r,i){
      return '<tr class="clickable" data-id="'+esc(r.id)+'">'+
        '<td>'+(i+1)+'</td>'+
        '<td>'+esc(r.name)+'</td>'+
        '<td>'+esc(r.lastWork)+'</td>'+
        '<td>'+r.txCount+'</td>'+
        '<td>'+esc(fmtDate(r.lastDate))+'</td>'+
        '<td class="num '+balCls(r.balance)+'">'+fmt(r.balance)+'</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b">No ledgers</td></tr>';
  }
  renderList('');

  search.addEventListener('input', function(e){ renderList(e.target.value); });

  listBody.addEventListener('click', function(e){
    var tr = e.target.closest('tr.clickable'); if(!tr) return;
    showHistory(tr.getAttribute('data-id'));
  });

  document.getElementById('btn-back').addEventListener('click', function(){
    document.getElementById('history-view').classList.add('hidden');
    document.getElementById('list-view').classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
  });

  function showHistory(id){
    var meta = DATA.summary.find(function(s){ return String(s.id)===String(id); });
    var rows = DATA.history[id] || [];
    document.getElementById('h-name').textContent = meta ? meta.name : 'Ledger';
    var tbody = document.getElementById('history-body');
    var totC=0,totD=0;
    rows.forEach(function(r){ totC+=Number(r.credit)||0; totD+=Number(r.debit)||0; });
    document.getElementById('h-credit').textContent = fmt(totC);
    document.getElementById('h-debit').textContent = fmt(totD);
    document.getElementById('h-balance').textContent = fmt(totC-totD);
    tbody.innerHTML = rows.map(function(r){
      return '<tr>'+
        '<td>'+r.slNo+'</td>'+
        '<td>'+esc(fmtDate(r.date))+'</td>'+
        '<td>'+esc(r.work)+(r.attachments&&r.attachments.length?'<span class="att">'+r.attachments.length+' attachment(s)</span>':'')+'</td>'+
        '<td class="num">'+fmt(r.credit)+'</td>'+
        '<td class="num">'+fmt(r.debit)+'</td>'+
        '<td class="num '+balCls(r.balance)+'">'+fmt(r.balance)+'</td>'+
        '<td>'+esc(r.remarks||'-')+'</td>'+
      '</tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:#64748b">No transactions</td></tr>';
    document.getElementById('list-view').classList.add('hidden');
    document.getElementById('history-view').classList.remove('hidden');
    window.scrollTo({top:0,behavior:'smooth'});
  }
})();
</script>
</body>
</html>`
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
    function handleLedgerSelect(ledger) {
      setSelectedLedger(ledger)
      setView('history')
    }
  const sessionUser = getSessionUser()
  const isAjithUser = sessionUser?.username?.trim().toLowerCase() === 'ajith'
  const [entries, setEntries] = useState([])
  const [ledgers, setLedgers] = useState([])
  const [allLedgerEntries, setAllLedgerEntries] = useState([])
  const [selectedLedger, setSelectedLedger] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    work: '',
    date: getTodayInputDate(),
    credit: '',
    debit: '',
    remarks: '',
    attachments: [],
  })
  const [searchText, setSearchText] = useState('')
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)
  const [view, setView] = useState('list')
  const [addReturnView, setAddReturnView] = useState('list')
  const [selectedClient, setSelectedClient] = useState('')
  const [isNameLocked, setIsNameLocked] = useState(false)
  const [addMode, setAddMode] = useState('new-ledger') // 'new-ledger' | 'new-entry'
  const [historySearchText, setHistorySearchText] = useState('')
  const [listMonth, setListMonth] = useState('')
  const [listYear, setListYear] = useState('')
  const [historyMonth, setHistoryMonth] = useState('')
  const [historyYear, setHistoryYear] = useState('')
  const [downloadOpen, setDownloadOpen] = useState(false)
  const downloadRef = useRef(null)
  const [editingEntry, setEditingEntry] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [isUploadingBackup, setIsUploadingBackup] = useState(false)
  const [backupNotice, setBackupNotice] = useState(null) // { fileName, link }



  // Only fetch ledgers on mount
  useEffect(() => {
    async function fetchLedgers() {
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('ledgers')
        .select('*')
        .order('date', { ascending: false })
      if (error) {
        setError('Failed to load ledgers')
        setLedgers([])
      } else {
        setLedgers(data || [])
      }
      setLoading(false)
    }
    fetchLedgers()
  }, [])

  // Fetch entries only when a ledger is selected (e.g., for history/details)
  useEffect(() => {
    if (!selectedLedger) {
      setEntries([])
      return
    }
    async function fetchEntriesForLedger() {
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('ledger_entries')
        .select('*')
        .eq('ledger_id', selectedLedger.id)
        .order('date', { ascending: false })
      if (error) {
        setError('Failed to load entries')
        setEntries([])
      } else {
        const safeLedgerName = selectedLedger.name || ''
        const normalizedEntries = (data || []).map((entry) => ({
          ...entry,
          name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : safeLedgerName,
        }))
        setEntries(normalizedEntries)
      }
      setLoading(false)
    }
    fetchEntriesForLedger()
  }, [selectedLedger])

  useEffect(() => {
    const ledgerIds = ledgers.map((ledger) => ledger.id).filter(Boolean)
    if (ledgerIds.length === 0) {
      setAllLedgerEntries([])
      return
    }

    async function fetchAllLedgerEntries() {
      const { data, error } = await supabase
        .from('ledger_entries')
        .select('*')
        .in('ledger_id', ledgerIds)
      if (error) {
        setAllLedgerEntries([])
        return
      }
      setAllLedgerEntries(data || [])
    }

    fetchAllLedgerEntries()
  }, [ledgers])

  const rowsWithBalance = useMemo(() => {
    const userBalances = new Map()

    return entries.map((entry, index) => {
      const credit = Number(entry.credit) || 0
      const debit = Number(entry.debit) || 0
      const attachments = normalizeAttachments(entry)
      const safeDate = toIsoDateOrNow(entry.date)
      const safeName =
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name
          : selectedLedger?.name || selectedClient || 'Unknown'
      const userKey = safeName.trim().toLowerCase()
      const previousBalance = userBalances.get(userKey) || 0
      const amount = previousBalance + credit - debit
      userBalances.set(userKey, amount)

      return {
        ...entry,
        name: safeName,
        slNo: index + 1,
        date: safeDate,
        credit,
        debit,
        amount,
        attachments,
        attachmentNames: attachments.map((item) => item.name).join(' '),
      }
    })
  }, [entries, selectedLedger, selectedClient])

  const ledgerSummaryRows = useMemo(() => {
    const entriesByLedgerId = new Map()

    allLedgerEntries.forEach((entry) => {
      const list = entriesByLedgerId.get(entry.ledger_id) || []
      list.push(entry)
      entriesByLedgerId.set(entry.ledger_id, list)
    })

    return ledgers
      .map((ledger) => {
        const safeName = typeof ledger.name === 'string' ? ledger.name.trim() : ''
        const ledgerEntries = entriesByLedgerId.get(ledger.id) || []
        const latestEntry = [...ledgerEntries].sort((a, b) => {
          const aTime = new Date(toIsoDateOrNow(a.date)).getTime()
          const bTime = new Date(toIsoDateOrNow(b.date)).getTime()
          return bTime - aTime
        })[0]
        const amount = ledgerEntries.reduce((sum, entry) => {
          return sum + ((Number(entry.credit) || 0) - (Number(entry.debit) || 0))
        }, 0)
        const attachments = normalizeAttachments(latestEntry || ledger)

        return {
          ...ledger,
          name: safeName,
          work: latestEntry?.work || ledger.work || '-',
          date: latestEntry?.date || ledger.date || '',
          amount,
          txCount: ledgerEntries.length,
          remarks: latestEntry?.remarks || ledger.remarks || '',
          attachments,
          attachmentNames: attachments.map((item) => item.name).join(' '),
        }
      })
      .sort((a, b) => {
        // Sort by latest transaction date (desc) so most recently active ledgers float to top.
        const aTime = a.date ? new Date(a.date).getTime() : 0
        const bTime = b.date ? new Date(b.date).getTime() : 0
        return bTime - aTime
      })
      .map((row, index) => ({ ...row, slNo: index + 1 }))
  }, [ledgers, allLedgerEntries])

  const yearOptions = useMemo(() => {
    const years = new Set()
    const currentYear = new Date().getFullYear()

    for (let year = currentYear; year <= currentYear + 4; year += 1) {
      years.add(String(year))
    }

    ledgerSummaryRows.forEach((row) => {
      const dateKey = toDateKey(row.date)
      if (dateKey) years.add(dateKey.slice(0, 4))
    })

    return Array.from(years).sort((a, b) => Number(a) - Number(b))
  }, [ledgerSummaryRows])

  const dateFilteredRows = useMemo(() => {
    return ledgerSummaryRows.filter(
      (row) => isMatchingMonthYear(row.date, listMonth, listYear),
    )
  }, [ledgerSummaryRows, listMonth, listYear])

  const totals = useMemo(() => {
    return dateFilteredRows.reduce(
      (acc, row) => {
        acc.amount += row.amount
        return acc
      },
      { amount: 0 },
    )
  }, [dateFilteredRows])

  const filteredRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return dateFilteredRows

    return dateFilteredRows.filter((row) => {
      return [
        row.slNo,
        row.name,
        row.work,
        row.amount,
        row.txCount,
        row.remarks,
        row.attachmentNames,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [dateFilteredRows, searchText])

  const historyRows = useMemo(() => {
    return buildHistoryRows({
      entries,
      selectedClient,
      historyMonth,
      historyYear,
      isMatchingMonthYear,
    })
  }, [entries, selectedClient, historyMonth, historyYear])

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
        acc.balance = acc.credit - acc.debit
        return acc
      },
      { credit: 0, debit: 0, balance: 0 },
    )
  }, [filteredHistoryRows])

  const filteredTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.amount += row.amount
        return acc
      },
      { amount: 0 },
    )
  }, [filteredRows])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage))
  const pageStartIndex = (currentPage - 1) * rowsPerPage
  const paginatedRows = filteredRows.slice(pageStartIndex, pageStartIndex + rowsPerPage)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchText, rowsPerPage, listMonth, listYear])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  async function handleChange(event) {
    const { name, value, files } = event.target
    if (name === 'file') {
      setError('')
      const pickedFiles = Array.from(files || [])
      if (!pickedFiles.length) {
        return
      }
      if (form.attachments.length + pickedFiles.length > MAX_ATTACHMENTS) {
        setError(`You can attach up to ${MAX_ATTACHMENTS} files.`)
        event.target.value = ''
        return
      }

      try {
        const inlineAttachments = await convertFilesToInlineAttachments(pickedFiles)
        setForm((prev) => ({
          ...prev,
          attachments: [...prev.attachments, ...inlineAttachments],
        }))
      } catch (readError) {
        setError(`Attachment read failed: ${readError?.message || 'Please try again.'}`)
      }
      event.target.value = ''
    } else {
      setForm((prev) => ({ ...prev, [name]: value }))
    }
  }

  function resetForm(keepName = '', lockName = false) {
    setForm({
      name: keepName,
      work: '',
      date: getTodayInputDate(),
      credit: '',
      debit: '',
      remarks: '',
      attachments: [],
    })
    setIsNameLocked(lockName)
  }

  function openAddView(prefillName = '', lockName = false, returnView = 'list', mode = 'new-ledger') {
    resetForm(prefillName, lockName)
    setAddReturnView(returnView)
    setAddMode(mode)
    setView('add')
  }

  function handleOpenHistory(ledger) {
    if (!ledger) return
    setSelectedClient(ledger.name)
    setHistorySearchText('')
    setHistoryMonth('')
    setHistoryYear('')
    setSelectedLedger(ledger)
    setView('history')
  }

  function handleAddTransactionForLedger(ledger, returnView = 'history') {
    if (!ledger) return
    if (returnView === 'history') {
      setSelectedClient(ledger.name)
      setSelectedLedger(ledger)
    }
    openAddView(ledger.name, true, returnView, 'new-entry')
  }

  function buildBackupArtifact() {
    const exportedAt = new Date().toISOString()
    const exportedBy = sessionUser?.username || 'unknown'

    const entriesByLedgerId = new Map()
    allLedgerEntries.forEach((entry) => {
      const list = entriesByLedgerId.get(entry.ledger_id) || []
      list.push(entry)
      entriesByLedgerId.set(entry.ledger_id, list)
    })

    const summary = ledgers
      .map((ledger) => {
        const list = entriesByLedgerId.get(ledger.id) || []
        const sorted = [...list].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        )
        const latest = sorted[0]
        const balance = list.reduce(
          (s, e) => s + ((Number(e.credit) || 0) - (Number(e.debit) || 0)),
          0,
        )
        return {
          id: ledger.id,
          name: (ledger.name || '').trim() || 'Unknown',
          lastWork: latest?.work || ledger.work || '-',
          lastDate: latest?.date || ledger.date || '',
          txCount: list.length,
          balance,
        }
      })
      .sort(
        (a, b) =>
          new Date(b.lastDate || 0).getTime() - new Date(a.lastDate || 0).getTime(),
      )

    const history = {}
    ledgers.forEach((ledger) => {
      const list = (entriesByLedgerId.get(ledger.id) || [])
        .slice()
        .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      let running = 0
      const rows = list.map((entry, idx) => {
        const credit = Number(entry.credit) || 0
        const debit = Number(entry.debit) || 0
        running += credit - debit
        return {
          slNo: idx + 1,
          date: entry.date || '',
          work: entry.work || '-',
          credit,
          debit,
          balance: running,
          remarks: entry.remarks || '',
          attachments: Array.isArray(entry.attachments) ? entry.attachments : [],
        }
      })
      history[ledger.id] = rows.reverse().map((r, idx) => ({ ...r, slNo: idx + 1 }))
    })

    const totalBalance = summary.reduce((s, r) => s + r.balance, 0)
    const totalTxns = summary.reduce((s, r) => s + r.txCount, 0)

    const data = {
      app: APP_CONFIG.appName,
      tagline: APP_CONFIG.tagline,
      exportedAt,
      exportedBy,
      totalLedgers: summary.length,
      totalTxns,
      totalBalance,
      summary,
      history,
    }

    const html = buildBackupHtml(data)
    const stamp = exportedAt.replace(/[:.]/g, '-').slice(0, 19)
    return { html, fileName: `ledger-backup-${stamp}.html` }
  }

  async function handleBackupUploadToDrive() {
    if (!isDriveConfigured()) {
      setError(
        'Google Drive not configured. Set VITE_GOOGLE_CLIENT_ID and VITE_GDRIVE_BACKUP_FOLDER_ID in .env.',
      )
      return
    }
    setError('')
    setBackupNotice(null)
    setIsUploadingBackup(true)
    try {
      const { html, fileName } = buildBackupArtifact()
      const result = await uploadHtmlToDrive({ fileName, html })
      setBackupNotice({
        fileName,
        link: result?.webViewLink || '',
        uploadedAt: new Date(),
      })
    } catch (err) {
      setError(`Upload failed: ${err?.message || 'Unknown error'}`)
    } finally {
      setIsUploadingBackup(false)
    }
  }

  function handleDownloadHistoryExcel() {
    if (!selectedClient || filteredHistoryRows.length === 0) return

    const rows = filteredHistoryRows.map((row) => [
      row.slNo,
      row.work,
      formatDateTime(row.date),
      formatPdfCurrency(row.credit),
      formatPdfCurrency(row.debit),
      formatPdfCurrency(row.balance),
      row.remarks || '-',
      row.attachmentNames || '-',
    ])

    const worksheet = XLSX.utils.aoa_to_sheet([
      [selectedClient],
      [`Generated`, new Date().toLocaleString()],
      [
        'Total Txn',
        filteredHistoryRows.length,
        'Credit (Rs)',
        formatPdfCurrency(historyTotals.credit),
        'Debit (Rs)',
        formatPdfCurrency(historyTotals.debit),
        'Balance (Rs)',
        formatPdfCurrency(historyTotals.balance),
      ],
      [],
      ['Sl No', 'Work', 'Date', 'Credit (Rs)', 'Debit (Rs)', 'Balance (Rs)', 'Remarks', 'Attachment'],
      ...rows,
    ])

    worksheet['!cols'] = [
      { wch: 8 },
      { wch: 24 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 20 },
      { wch: 28 },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Mini Statement')

    const fileBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const fileName = `${formatFilePart(selectedClient)}-mini-statement.xlsx`
    downloadBlob(
      fileBuffer,
      fileName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  }

  function handleDownloadHistoryPdf() {
    if (!selectedClient || filteredHistoryRows.length === 0) return

    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const left = 36
    const right = pageWidth - 36
    const tableWidth = right - left
    const baseRowHeight = 22
    const bottomMargin = 40
    const columns = [
      { key: 'slNo', label: 'Sl No', width: 38, align: 'left' },
      { key: 'date', label: 'Date', width: 104, align: 'left' },
      { key: 'work', label: 'Work', width: 137, align: 'left' },
      { key: 'credit', label: 'Credit (Rs)', width: 81, align: 'right' },
      { key: 'debit', label: 'Debit (Rs)', width: 81, align: 'right' },
      { key: 'balance', label: 'Balance (Rs)', width: 82, align: 'right' },
    ]

    let y = 42

    function drawHeader() {
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(selectedClient, left, y)
      y += 20

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`Generated: ${new Date().toLocaleString()}`, left, y)
      y += 16

      const summaryTop = y
      const boxGap = 8
      const boxWidth = (tableWidth - boxGap * 3) / 4
      const boxHeight = 34
      const summaryItems = [
        ['Transactions', String(filteredHistoryRows.length)],
        ['Credit (Rs)', formatPdfCurrency(historyTotals.credit)],
        ['Debit (Rs)', formatPdfCurrency(historyTotals.debit)],
        ['Balance (Rs)', formatPdfCurrency(historyTotals.balance)],
      ]

      summaryItems.forEach((item, index) => {
        const x = left + index * (boxWidth + boxGap)
        doc.setFillColor(250, 250, 250)
        doc.setDrawColor(205, 210, 215)
        doc.roundedRect(x, summaryTop, boxWidth, boxHeight, 4, 4, 'FD')
        doc.setFontSize(8)
        doc.setTextColor(90, 95, 100)
        doc.text(item[0], x + 8, summaryTop + 11)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(20, 25, 30)
        doc.text(item[1], x + 8, summaryTop + 25)
        doc.setFont('helvetica', 'normal')
      })

      y += boxHeight + 14

      doc.setFillColor(244, 246, 248)
      doc.rect(left, y, tableWidth, baseRowHeight, 'F')
      doc.setDrawColor(180, 185, 190)
      doc.rect(left, y, tableWidth, baseRowHeight)

      let x = left
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      columns.forEach((column) => {
        doc.line(x, y, x, y + baseRowHeight)
        const textX = column.align === 'right' ? x + column.width - 6 : x + 6
        doc.text(column.label, textX, y + 14, { align: column.align === 'right' ? 'right' : 'left' })
        x += column.width
      })
      doc.line(x, y, x, y + baseRowHeight)
      y += baseRowHeight
    }

    function ensureSpace(requiredHeight) {
      if (y + requiredHeight <= pageHeight - bottomMargin) return
      doc.addPage()
      y = 42
      drawHeader()
    }

    drawHeader()

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)

    filteredHistoryRows.forEach((row) => {
      const rowValues = {
        slNo: String(row.slNo),
        date: formatDateTime(row.date),
        work: row.work || '-',
        credit: formatPdfCurrency(row.credit),
        debit: formatPdfCurrency(row.debit),
        balance: formatPdfCurrency(row.balance),
      }

      const wrappedCells = columns.map((column) => {
        const text = rowValues[column.key]
        if (column.align === 'right') return [text]
        return doc.splitTextToSize(text, column.width - 12)
      })

      const rowHeight = Math.max(
        baseRowHeight,
        ...wrappedCells.map((lines) => 8 + lines.length * 11),
      )

      ensureSpace(rowHeight)

      doc.rect(left, y, tableWidth, rowHeight)

      let x = left
      wrappedCells.forEach((lines, index) => {
        const column = columns[index]
        doc.line(x, y, x, y + rowHeight)

        if (column.align === 'right') {
          lines.forEach((line, lineIndex) => {
            doc.text(line, x + column.width - 6, y + 14 + lineIndex * 11, { align: 'right' })
          })
        } else {
          doc.text(lines, x + 6, y + 14)
        }

        x += column.width
      })

      doc.line(x, y, x, y + rowHeight)
      y += rowHeight
    })

    const fileName = `${formatFilePart(selectedClient)}-mini-statement.pdf`
    doc.save(fileName)
  }

  async function handleAddEntry(event) {
    event.preventDefault()
    if (isSaving) return
    setError('')

    const name = form.name.trim()
    const work = form.work.trim()
    const credit = Number(form.credit) || 0
    const debit = Number(form.debit) || 0

    if (!name) {
      setError('Name is required.')
      return
    }

    if (!work) {
      setError('Work is required.')
      return
    }

    if (credit <= 0 && debit <= 0) {
      setError('Enter credit or debit amount.')
      return
    }

    setIsSaving(true)

    try {
      const now = new Date()
      let dateValue = now.toISOString()

      if (form.date) {
        const [year, month, day] = form.date.split('-').map(Number)
        if (year && month && day) {
          const selectedWithCurrentTime = new Date(
            year,
            month - 1,
            day,
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
            now.getMilliseconds(),
          )
          dateValue = selectedWithCurrentTime.toISOString()
        }
      }

      // Decide whether to attach to an existing ledger or create a new one.
      // - Add Txn button (addMode='new-entry') -> attach to the exact ledger (selectedLedger) by id.
      // - Add New button (addMode='new-ledger') -> always create a brand-new ledger row,
      //   even if a ledger with the same name already exists.
      const ledgerName = name
      let ledger = addMode === 'new-entry' ? selectedLedger : null

      async function addTxWithLedger(ledgerId) {
        const nextEntry = {
          ledger_id: ledgerId,
          work,
          date: dateValue,
          credit,
          debit,
          remarks: form.remarks.trim(),
          attachments: form.attachments,
        }
        setLoading(true)
        setError('')
        const { data, error } = await supabase
          .from('ledger_entries')
          .insert([nextEntry])
          .select()
        if (error) {
          setError('Failed to add entry')
        } else {
          const fallbackName = form.name.trim() || selectedLedger?.name || selectedClient || 'Unknown'
          const normalizedNewEntries = (data || []).map((entry) => ({
            ...entry,
            name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : fallbackName,
          }))
          setEntries((prev) => [...prev, ...normalizedNewEntries])
          setAllLedgerEntries((prev) => [...prev, ...(data || [])])
          if (!searchText.trim()) {
            setCurrentPage(Math.ceil((entries.length + 1) / rowsPerPage))
          }
          resetForm()
          setView(addReturnView)
        }
        setLoading(false)
      }

      if (ledger) {
        await addTxWithLedger(ledger.id)
      } else {
        setLoading(true)
        setError('')
let userId = null

try {
  const userStr = sessionStorage.getItem('user')
  if (userStr) {
    const user = JSON.parse(userStr)
    userId = user?.id
  }
} catch (err) {
  console.error('Error reading user:', err)
}

        if (!userId) {
          alert('You must be logged in to save transactions.')
          setError('User not authenticated')
          setLoading(false)
          return
        }

        const newLedgerPayload = {
          name: ledgerName,
          user_id: userId,
          work,
          date: dateValue,
          credit,
          debit,
          remarks: form.remarks.trim() || null,
          attachments: form.attachments.length > 0 ? form.attachments : null,
        }

        const { data, error } = await supabase
          .from('ledgers')
          .insert([newLedgerPayload])
          .select()
        if (error || !data || !data[0]) {
          setError('Failed to create ledger')
          setLoading(false)
          return
        }
        setLedgers((prev) => [...prev, data[0]])
        await addTxWithLedger(data[0].id)
      }
    } finally {
      setIsSaving(false)
    }
  }

  function handleDeleteEntry(row) {
    setConfirmDelete({ kind: 'entry', row })
  }

  function handleDeleteLedger(ledger) {
    setConfirmDelete({ kind: 'ledger', row: ledger })
  }

  async function confirmDeleteAction() {
    const target = confirmDelete
    setConfirmDelete(null)
    if (!target) return

    if (target.kind === 'entry') {
      const row = target.row
      const { error: deleteError } = await supabase
        .from('ledger_entries')
        .delete()
        .eq('id', row.id)
      if (deleteError) {
        setError('Failed to delete entry.')
      } else {
        setEntries((prev) => prev.filter((e) => e.id !== row.id))
        setAllLedgerEntries((prev) => prev.filter((e) => e.id !== row.id))
      }
      return
    }

    if (target.kind === 'ledger') {
      const ledger = target.row
      // Delete child entries first, then the ledger row.
      const { error: entriesErr } = await supabase
        .from('ledger_entries')
        .delete()
        .eq('ledger_id', ledger.id)
      if (entriesErr) {
        setError('Failed to delete ledger entries.')
        return
      }
      const { error: ledgerErr } = await supabase
        .from('ledgers')
        .delete()
        .eq('id', ledger.id)
      if (ledgerErr) {
        setError('Failed to delete ledger.')
        return
      }
      setLedgers((prev) => prev.filter((l) => l.id !== ledger.id))
      setAllLedgerEntries((prev) => prev.filter((e) => e.ledger_id !== ledger.id))
      if (selectedLedger?.id === ledger.id) {
        setSelectedLedger(null)
        setEntries([])
        setSelectedClient('')
        setView('list')
      }
    }
  }

  function openEditModal(row) {
    setEditingEntry(row)
    setEditForm({
      work: row.work || '',
      date: toDateKey(row.date),
      credit: row.credit !== 0 ? String(row.credit) : '',
      debit: row.debit !== 0 ? String(row.debit) : '',
      remarks: row.remarks || '',
      attachments: row.attachments || [],
    })
    setError('')
  }

  function closeEditModal() {
    setEditingEntry(null)
    setEditForm(null)
    setError('')
  }

  async function handleEditChange(event) {
    const { name, value, files } = event.target
    if (name === 'file') {
      setError('')
      const pickedFiles = Array.from(files || [])
      if (!pickedFiles.length) return
      const currentAttachments = editForm.attachments || []
      if (currentAttachments.length + pickedFiles.length > MAX_ATTACHMENTS) {
        setError(`You can attach up to ${MAX_ATTACHMENTS} files.`)
        event.target.value = ''
        return
      }
      try {
        const inlineAttachments = await convertFilesToInlineAttachments(pickedFiles)
        setEditForm((prev) => ({
          ...prev,
          attachments: [...prev.attachments, ...inlineAttachments],
        }))
      } catch (readError) {
        setError(`Attachment read failed: ${readError?.message || 'Please try again.'}`)
      }
      event.target.value = ''
    } else {
      setEditForm((prev) => ({ ...prev, [name]: value }))
    }
  }

  async function handleSaveEdit(event) {
    event.preventDefault()
    if (isEditSaving || !editingEntry) return
    setError('')

    const work = editForm.work.trim()
    const credit = Number(editForm.credit) || 0
    const debit = Number(editForm.debit) || 0

    if (!work) { setError('Work is required.'); return }
    if (credit <= 0 && debit <= 0) { setError('Enter credit or debit amount.'); return }

    setIsEditSaving(true)
    try {
      const now = new Date()
      let dateValue = now.toISOString()
      if (editForm.date) {
        const [year, month, day] = editForm.date.split('-').map(Number)
        if (year && month && day) {
          const d = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
          dateValue = d.toISOString()
        }
      }

      const updates = {
        work,
        date: dateValue,
        credit,
        debit,
        remarks: editForm.remarks.trim(),
        attachments: editForm.attachments,
      }

      const { error: updateError } = await supabase
        .from('ledger_entries')
        .update(updates)
        .eq('id', editingEntry.id)

      if (updateError) {
        setError('Failed to update entry.')
      } else {
        setEntries((prev) =>
          prev.map((e) => (e.id === editingEntry.id ? { ...e, ...updates } : e))
        )
        setAllLedgerEntries((prev) =>
          prev.map((e) => (e.id === editingEntry.id ? { ...e, ...updates } : e))
        )
        closeEditModal()
      }
    } finally {
      setIsEditSaving(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        {view === 'list' && (
          <>
            <header className="app-header">
              <img src="/logo.svg" alt="Ledger logo" className="app-logo" />
              <div className="app-header-text">
                <h1>{APP_CONFIG.appName}</h1>
                <p className="app-tagline">{APP_CONFIG.tagline}</p>
              </div>
              <button type="button" className="logout-btn" onClick={onLogout}>Logout</button>
            </header>
          </>
        )}

        {view === 'add' ? (
          <>
            <div className="page-title-bar">
              <h2 className="page-title">{isNameLocked ? form.name : 'Add New Ledger'}</h2>
            </div>

            <form className="entry-form" onSubmit={handleAddEntry}>
              <input
                name="name"
                placeholder="Name"
                value={form.name}
                onChange={handleChange}
                readOnly={isNameLocked}
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
                placeholder="Remarks"
                value={form.remarks}
                onChange={handleChange}
                rows={2}
                style={{ gridColumn: 'span 2', resize: 'vertical' }}
              />
              <label className="date-field" style={{ gridColumn: 'span 2' }}>
                Attachment
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
              {error && (
                <p className="login-error" style={{ gridColumn: 'span 2', margin: 0 }}>
                  {error}
                </p>
              )}
              <div className="form-actions" style={{ gridColumn: 'span 2' }}>
                <button
                  type="button"
                  className="ghost back-btn"
                  disabled={isSaving}
                  onClick={() => {
                    resetForm()
                    setView(addReturnView)
                  }}
                >
                  Back
                </button>
                <button type="submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Transaction'}
                </button>
              </div>
            </form>
          </>
        ) : view === 'history' ? (
          <>
            <div className="page-title-bar history-title-bar">
              <h2 className="page-title">{selectedClient}</h2>
              <span className="history-header-total">Total Txn: <strong>{filteredHistoryRows.length}</strong></span>
            </div>

            <div className="history-summary-cards">
              <article className="summary-card">
                <span className="summary-label">Credit</span>
                <strong className="summary-value">{formatCurrency(historyTotals.credit)}</strong>
              </article>
              <article className="summary-card">
                <span className="summary-label">Debit</span>
                <strong className="summary-value">{formatCurrency(historyTotals.debit)}</strong>
              </article>
              <article className="summary-card summary-card-emphasis">
                <span className="summary-label">Balance</span>
                <strong className="summary-value">{formatCurrency(historyTotals.balance)}</strong>
              </article>
            </div>

            <div className="history-toolbar">
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
              <input
                aria-label="Search history rows"
                className="search-input"
                type="search"
                placeholder="Search by work, amount, remarks..."
                value={historySearchText}
                onChange={(event) => setHistorySearchText(event.target.value)}
              />
            </div>

            <div className="history-add-txn-row">
              <button
                type="button"
                className="ghost back-btn"
                onClick={() => {
                  setSelectedClient('')
                  setHistorySearchText('')
                  setHistoryMonth('')
                  setHistoryYear('')
                  setView('list')
                }}
              >
                ← Back
              </button>
              <div className="history-download-dropdown" ref={downloadRef}>
                <button
                  type="button"
                  className="table-action-btn history-download-trigger"
                  onClick={() => setDownloadOpen((prev) => !prev)}
                >
                  Download ▾
                </button>
                {downloadOpen && (
                  <div className="history-download-menu">
                    <button
                      type="button"
                      className="table-action-btn"
                      disabled={filteredHistoryRows.length === 0}
                      onClick={() => { handleDownloadHistoryPdf(); setDownloadOpen(false) }}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      className="ghost table-action-btn"
                      disabled={filteredHistoryRows.length === 0}
                      onClick={() => { handleDownloadHistoryExcel(); setDownloadOpen(false) }}
                    >
                      Excel
                    </button>
                  </div>
                )}
              </div>
              <button type="button" id="add-txn-btn" className="table-action-btn" onClick={() => selectedLedger && handleAddTransactionForLedger(selectedLedger, 'history')}>
                Add Txn
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sl No</th>
                    <th>Work</th>
                    <th>Date</th>
                    <th>Credit (Rs)</th>
                    <th>Debit (Rs)</th>
                    <th>Balance (Rs)</th>
                    <th>Remarks</th>
                    <th>Attachment</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="9" className="table-loading-cell">
                        <div className="table-loader" role="status" aria-live="polite">
                          <span className="table-loader-dot" />
                          Loading history...
                        </div>
                      </td>
                    </tr>
                  ) : filteredHistoryRows.length > 0 ? (
                    filteredHistoryRows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Sl No">{row.slNo}</td>
                        <td data-label="Work">{row.work}</td>
                        <td data-label="Date">{formatDateTime(row.date)}</td>
                        <td data-label="Credit (Rs)">{formatAmount(row.credit)}</td>
                        <td data-label="Debit (Rs)">{formatAmount(row.debit)}</td>
                        <td data-label="Balance (Rs)">{formatAmount(row.balance)}</td>
                        <td data-label="Remarks">{row.remarks || '-'}</td>
                        <td data-label="Attachment">
                          {row.attachments.length > 0 ? (
                            <div className="attachment-list">
                              {row.attachments.map((item) => (
                                <a
                                  key={`${row.id}-${item.name}`}
                                  href={item.url}
                                  download={item.name}
                                  className="file-download-link"
                                >
                                  📎 {item.name}
                                </a>
                              ))}
                            </div>
                          ) : '-'}
                        </td>
                        <td data-label="Action" className="actions-cell">
                          <div className="actions-wrap">
                            <button
                              type="button"
                              className="ghost table-action-btn"
                              onClick={() => openEditModal(row)}
                            >
                              Edit
                            </button>
                            {isAjithUser && (
                              <button
                                type="button"
                                className="table-action-btn danger-btn"
                                onClick={() => handleDeleteEntry(row)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="9">No history for this client</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="list-actions">
              <button type="button" id="add-new-btn" className="add-new-btn" onClick={() => openAddView('', false, 'list', 'new-ledger')}>
                + Add New
              </button>
              {isAjithUser && (
                <button
                  type="button"
                  id="backup-upload-btn"
                  className="table-action-btn"
                  onClick={handleBackupUploadToDrive}
                  disabled={loading || ledgers.length === 0 || isUploadingBackup}
                  title="Upload backup HTML to Google Drive"
                >
                  {isUploadingBackup ? 'Uploading…' : '☁ Upload to Drive'}
                </button>
              )}
            </div>

            {backupNotice && (
              <div className="backup-notice" role="status" aria-live="polite">
                <span className="backup-notice-icon" aria-hidden="true">✓</span>
                <div className="backup-notice-text">
                  <strong>Backup uploaded successfully</strong>
                  <span>{backupNotice.fileName}</span>
                </div>
                <div className="backup-notice-actions">
                  {backupNotice.link && (
                    <a
                      className="ghost table-action-btn"
                      href={backupNotice.link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Drive
                    </a>
                  )}
                  <button
                    type="button"
                    className="backup-notice-close"
                    aria-label="Dismiss"
                    onClick={() => setBackupNotice(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="list-toolbar">
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
              <input
                aria-label="Search ledger rows"
                className="search-input"
                type="search"
                placeholder="Search by name, work, amount..."
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Sl No</th>
                    <th>Name</th>
                    <th>Last Work</th>
                    <th>Count</th>
                    <th>Last Date</th>
                    <th>Balance (Rs)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="7" className="table-loading-cell">
                        <div className="table-loader" role="status" aria-live="polite">
                          <span className="table-loader-dot" />
                          Loading ledgers...
                        </div>
                      </td>
                    </tr>
                  ) : paginatedRows.length > 0 ? (
                    paginatedRows.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Sl No">{row.slNo}</td>
                        <td data-label="Name">{row.name}</td>
                        <td data-label="Last Work">{row.work}</td>
                        <td data-label="Count">{isAjithUser ? row.txCount : '-'}</td>
                        <td data-label="Last Date">{formatDateTime(row.date)}</td>
                        <td data-label="Balance (Rs)">{formatAmount(row.amount)}</td>
                        <td data-label="Action" className="actions-cell">
                          <div className="actions-wrap">
                            <button
                              type="button"
                              className="ghost table-action-btn"
                              onClick={() => handleOpenHistory(row)}
                            >
                              Statement
                            </button>
                            <button
                              type="button"
                              className="table-action-btn add-txn-row-btn"
                              data-action="add-txn"
                              data-ledger-id={row.id}
                              onClick={() => handleAddTransactionForLedger(row, 'list')}
                            >
                              Add Txn
                            </button>
                            {isAjithUser && (
                              <button
                                type="button"
                                className="table-action-btn danger-btn"
                                data-action="delete-ledger"
                                data-ledger-id={row.id}
                                onClick={() => handleDeleteLedger(row)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7">No ledgers</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan="4">Total</th>
                    <th>{formatAmount(searchText ? filteredTotals.amount : totals.amount)}</th>
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
          <p className="app-footer-primary">&copy; {new Date().getFullYear()} {APP_CONFIG.appName}. All rights reserved.</p>
          <p className="app-footer-secondary">Developed by <strong>{APP_CONFIG.developerName}</strong></p>
        </footer>
      </section>

      {confirmDelete && (
        <div className="edit-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog-icon">🗑️</div>
            <h3 className="confirm-dialog-title">
              {confirmDelete.kind === 'ledger' ? 'Delete Ledger?' : 'Delete Transaction?'}
            </h3>
            <p className="confirm-dialog-msg">
              {confirmDelete.kind === 'ledger' ? (
                <>
                  Ledger <strong>"{confirmDelete.row.name}"</strong> and all its transactions will be permanently deleted. This cannot be undone.
                </>
              ) : (
                <>
                  <strong>"{confirmDelete.row.work}"</strong> will be permanently deleted. This cannot be undone.
                </>
              )}
            </p>
            <div className="confirm-dialog-actions">
              <button type="button" className="ghost back-btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="table-action-btn danger-btn" onClick={confirmDeleteAction}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingEntry && editForm && (
        <div className="edit-modal-overlay" onClick={closeEditModal}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-title-bar">
              <h2 className="page-title">Edit Transaction</h2>
              <button type="button" className="ghost edit-modal-close" onClick={closeEditModal}>✕</button>
            </div>
            <form className="entry-form" onSubmit={handleSaveEdit}>
              <input
                name="work"
                placeholder="Work"
                value={editForm.work}
                onChange={handleEditChange}
                required
              />
              <input
                name="credit"
                type="number"
                min="0"
                placeholder="Credit"
                value={editForm.credit}
                onChange={handleEditChange}
              />
              <input
                name="debit"
                type="number"
                min="0"
                placeholder="Debit"
                value={editForm.debit}
                onChange={handleEditChange}
              />
              <label className="date-field">
                Date
                <input
                  name="date"
                  type="date"
                  value={editForm.date}
                  onChange={handleEditChange}
                />
              </label>
              <textarea
                name="remarks"
                placeholder="Remarks"
                value={editForm.remarks}
                onChange={handleEditChange}
                rows={2}
                style={{ gridColumn: 'span 2', resize: 'vertical' }}
              />
              <label className="date-field" style={{ gridColumn: 'span 2' }}>
                Attachment
                <input
                  name="file"
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={handleEditChange}
                />
                {editForm.attachments.length > 0 && (
                  <>
                    <span className="file-name-hint">{editForm.attachments.length} file(s)</span>
                    <span className="file-name-list">{editForm.attachments.map((item) => item.name).join(', ')}</span>
                  </>
                )}
              </label>
              {error && (
                <p className="login-error" style={{ gridColumn: 'span 2', margin: 0 }}>{error}</p>
              )}
              <div className="form-actions" style={{ gridColumn: 'span 2' }}>
                <button type="button" className="ghost back-btn" disabled={isEditSaving} onClick={closeEditModal}>
                  Cancel
                </button>
                <button type="submit" disabled={isEditSaving}>
                  {isEditSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
