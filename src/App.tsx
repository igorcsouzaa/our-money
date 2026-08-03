import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Heart,
  Home,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  TrendingUp,
  Utensils,
  WalletCards,
  X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { supabase } from './lib/supabase'
import './App.css'

type TransactionType = 'expense' | 'income'
type Category = { id: number; name: string; color: string }
type Transaction = {
  id: number
  title: string
  category: string
  categoryId: number | null
  date: string
  amount: number
  type: TransactionType
  createdBy: string
  createdAt: string
  owner: string
}

const categoryMeta: Record<string, { icon: typeof CreditCard; color: string; soft: string }> = {
  Moradia: { icon: Home, color: '#b89cff', soft: '#2b2140' },
  Alimentação: { icon: Utensils, color: '#f19a79', soft: '#35201f' },
  Renda: { icon: TrendingUp, color: '#70c5a3', soft: '#173129' },
  Outros: { icon: CreditCard, color: '#a9a0b4', soft: '#292330' },
}

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
const fullDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [householdId, setHouseholdId] = useState<number | null>(null)
  const [profileNames, setProfileNames] = useState<Record<string, string>>({})
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all')
  const [monthOffset, setMonthOffset] = useState(0)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const selectedMonth = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  }, [monthOffset])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user) void loadHouseholdData(session)
    else {
      setTransactions([])
      setHouseholdId(null)
      setProfileNames({})
    }
  }, [session])

  async function loadHouseholdData(activeSession: Session) {
    setDataLoading(true)
    setDataError('')
    try {
      const { data: memberships, error: membershipError } = await supabase
        .from('household_members').select('household_id').order('household_id').limit(1)
      if (membershipError) throw membershipError

      let activeHouseholdId = memberships?.[0]?.household_id as number | undefined
      if (!activeHouseholdId) {
        const { data: household, error: householdError } = await supabase
          .from('households')
          .insert({ name: 'Nosso espaço', created_by: activeSession.user.id })
          .select('id').single()
        if (householdError) throw householdError
        activeHouseholdId = household.id
        const { error: memberError } = await supabase.from('household_members').insert({
          household_id: activeHouseholdId, user_id: activeSession.user.id, role: 'owner',
        })
        if (memberError) throw memberError
      }

      const resolvedHouseholdId = activeHouseholdId as number
      setHouseholdId(resolvedHouseholdId)

      const [{ data: categoryRows, error: categoriesError }, { data: transactionRows, error: transactionsError }, { data: memberRows }] = await Promise.all([
        supabase.from('categories').select('id, name, color').eq('household_id', resolvedHouseholdId).order('name'),
        supabase.from('transactions').select('id, description, amount, type, transaction_date, created_at, created_by, category_id, categories(name)').eq('household_id', resolvedHouseholdId).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('household_members').select('user_id').eq('household_id', resolvedHouseholdId),
      ])
      if (categoriesError) throw categoriesError
      if (transactionsError) throw transactionsError

      let names: Record<string, string> = {}
      const memberIds = (memberRows ?? []).map((row) => row.user_id)
      if (memberIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', memberIds)
        names = Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile.display_name]))
      }
      const ownFallback = activeSession.user.user_metadata.full_name || activeSession.user.email?.split('@')[0] || 'Você'
      names[activeSession.user.id] ??= ownFallback
      setProfileNames(names)
      setCategories((categoryRows ?? []) as Category[])
      setTransactions((transactionRows ?? []).map((row: Record<string, unknown>) => {
        const joinedCategory = row.categories as { name?: string } | null
        const createdBy = String(row.created_by)
        return {
          id: Number(row.id), title: String(row.description),
          category: joinedCategory?.name ?? 'Sem categoria',
          categoryId: row.category_id ? Number(row.category_id) : null,
          date: String(row.transaction_date), amount: Number(row.amount),
          type: row.type as TransactionType, createdBy,
          createdAt: String(row.created_at),
          owner: names[createdBy] ?? 'Nós',
        }
      }))
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Não foi possível carregar os dados.')
    } finally {
      setDataLoading(false)
    }
  }

  const monthTransactions = useMemo(() => transactions.filter((item) => {
    const date = new Date(`${item.date}T12:00:00`)
    return date.getFullYear() === selectedMonth.getFullYear() && date.getMonth() === selectedMonth.getMonth()
  }), [transactions, selectedMonth])

  const totals = useMemo(() => {
    const income = monthTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
    const expense = monthTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
    return { income, expense, balance: income - expense }
  }, [monthTransactions])

  const memberSummaries = useMemo(() => Object.entries(profileNames)
    .sort(([firstId], [secondId]) => firstId === session?.user.id ? -1 : secondId === session?.user.id ? 1 : 0)
    .map(([userId, name]) => {
      const memberTransactions = monthTransactions.filter((item) => item.createdBy === userId)
      const income = memberTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
      const expense = memberTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
      return { userId, name, income, expense, balance: income - expense }
    }), [monthTransactions, profileNames, session?.user.id])

  const filteredTransactions = useMemo(() => monthTransactions
    .filter((item) => typeFilter === 'all' || item.type === typeFilter)
    .filter((item) => `${item.title} ${item.category} ${item.owner}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date)
      return dateOrder !== 0 ? dateOrder : b.createdAt.localeCompare(a.createdAt)
    }), [monthTransactions, query, typeFilter])

  const chartData = useMemo(() => {
    const grouped = new Map<number, { income: number; expense: number }>()
    monthTransactions.forEach((item) => {
      const day = new Date(`${item.date}T12:00:00`).getDate()
      const current = grouped.get(day) ?? { income: 0, expense: 0 }
      current[item.type] += item.amount
      grouped.set(day, current)
    })
    let income = 0
    let expense = 0
    return [...grouped.entries()].sort(([a], [b]) => a - b).map(([day, values]) => {
      income += values.income
      expense += values.expense
      return { day: String(day).padStart(2, '0'), receitas: income, despesas: expense }
    })
  }, [monthTransactions])

  const categoryTotals = useMemo(() => {
    const grouped = new Map<string, number>()
    monthTransactions.filter((item) => item.type === 'expense').forEach((item) => grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amount))
    return [...grouped.entries()].sort((a, b) => b[1] - a[1])
  }, [monthTransactions])

  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(selectedMonth)
  const myName = profileNames[session?.user.id ?? ''] || session?.user.user_metadata.full_name || 'Você'
  const coupleNames = Object.values(profileNames).filter(Boolean).join(' & ') || myName

  async function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session?.user || !householdId) return
    const form = event.currentTarget
    const data = new FormData(form)
    const categoryId = Number(data.get('category')) || null
    const selectedCategory = categories.find((category) => category.id === categoryId)
    const payload = {
      household_id: householdId, created_by: session.user.id, category_id: categoryId,
      description: String(data.get('title')).trim(), amount: Number(data.get('amount')),
      transaction_date: String(data.get('date')), type: String(data.get('type')),
    }
    const { data: saved, error } = await supabase.from('transactions').insert(payload).select('id').single()
    if (error) return setDataError(error.message)
    setTransactions((current) => [...current, {
      id: saved.id, title: payload.description, amount: payload.amount,
      category: selectedCategory?.name ?? 'Sem categoria', categoryId,
      date: payload.transaction_date, type: payload.type as TransactionType,
      createdBy: session.user.id, createdAt: new Date().toISOString(), owner: myName,
    }])
    form.reset()
    setIsModalOpen(false)
  }

  async function deleteTransaction(item: Transaction) {
    const confirmed = window.confirm(`Excluir “${item.title}” no valor de ${currency.format(item.amount)}?`)
    if (!confirmed) return

    setDeletingId(item.id)
    setDataError('')
    const { error } = await supabase.from('transactions').delete().eq('id', item.id)
    setDeletingId(null)

    if (error) {
      setDataError(error.message)
      return
    }

    setTransactions((current) => current.filter((transaction) => transaction.id !== item.id))
  }

  if (authLoading) return <div className="app-loading"><span /><p>Abrindo o espaço de vocês...</p></div>
  if (!session) return <AuthScreen />

  return <div className="app-shell intimate-shell">
    <aside className={`sidebar intimate-sidebar ${isMenuOpen ? 'sidebar--open' : ''}`}>
      <div className="brand"><span className="brand__mark"><Heart size={20} fill="currentColor" /></span><span>Nosso Caixa</span></div>
      <button className="sidebar-close" aria-label="Fechar menu" onClick={() => setIsMenuOpen(false)}><X /></button>
      <nav aria-label="Navegação principal">
        <span className="nav-label">Nosso espaço</span>
        <button className={!showAll ? 'nav-item active' : 'nav-item'} onClick={() => { setShowAll(false); setIsMenuOpen(false) }}><WalletCards size={19} />Nosso mês</button>
        <button className={showAll ? 'nav-item active' : 'nav-item'} onClick={() => { setShowAll(true); setIsMenuOpen(false) }}><ReceiptText size={19} />Cada gasto</button>
      </nav>
      <div className="sidebar-note"><Heart size={15} fill="currentColor" /><span>Um cantinho só de vocês dois.</span></div>
      <div className="sidebar-bottom">
        <div className="profile">
          <div className="personal-avatar">{myName.slice(0, 2).toUpperCase()}</div>
          <div><strong>{coupleNames}</strong><small>{Object.keys(profileNames).length}/2 pessoas</small></div>
          <button className="logout-button" aria-label="Sair" onClick={() => supabase.auth.signOut()}><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
    {isMenuOpen && <button className="backdrop" aria-label="Fechar menu" onClick={() => setIsMenuOpen(false)} />}

    <main>
      <header className="topbar intimate-topbar">
        <button className="icon-btn menu-btn" aria-label="Abrir menu" onClick={() => setIsMenuOpen(true)}><Menu /></button>
        <div className="mobile-brand">Nosso Caixa</div>
        <div className="topbar-actions"><button className="icon-btn notification" aria-label="Notificações"><Bell size={19} /></button><button className="primary-btn compact" onClick={() => setIsModalOpen(true)}><Plus size={18} />Anotar</button></div>
      </header>

      <div className="content intimate-content">
        {dataError && <div className="error-banner"><strong>Não conseguimos sincronizar.</strong><span>{dataError}</span><button onClick={() => loadHouseholdData(session)}>Tentar novamente</button></div>}
        {dataLoading && <div className="sync-status">Organizando os dados de vocês...</div>}
        <section className="page-heading intimate-heading">
          <div><p className="eyebrow">{fullDate.format(new Date()).toUpperCase()}</p><h1>Oi, {myName}. <span>♡</span></h1><p>Vamos cuidar do que é de vocês, uma coisinha por vez.</p></div>
          <div className="month-switcher"><button aria-label="Mês anterior" onClick={() => setMonthOffset((v) => v - 1)}><ChevronLeft /></button><strong>{monthLabel}</strong><button aria-label="Próximo mês" onClick={() => setMonthOffset((v) => v + 1)}><ChevronRight /></button></div>
        </section>

        {!showAll && <>
          <section className="summary-grid intimate-summary" aria-label="Resumo do mês">
            <article className="summary-card balance-card"><span className="summary-icon purple"><WalletCards size={21} /></span><p>Ficou com vocês</p><strong>{currency.format(totals.balance)}</strong><small>o que entrou menos o que saiu</small></article>
            <article className="summary-card"><span className="summary-icon green"><ArrowDownLeft size={21} /></span><p>Entrou</p><strong>{currency.format(totals.income)}</strong><small>tudo que vocês receberam</small></article>
            <article className="summary-card"><span className="summary-icon orange"><ArrowUpRight size={21} /></span><p>Saiu</p><strong>{currency.format(totals.expense)}</strong><small>cada gasto anotado</small></article>
          </section>

          <section className="people-section" aria-labelledby="people-title">
            <div className="people-heading"><div><p className="eyebrow">CADA UM DE VOCÊS</p><h2 id="people-title">As duas contas, lado a lado</h2></div><span>Calculado por quem fez cada anotação</span></div>
            <div className="people-grid">
              {memberSummaries.map((member, index) => <article className={`person-card person-card--${index + 1}`} key={member.userId}>
                <div className="person-card__top"><span className="person-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.userId === session.user.id ? 'Sua conta' : 'Outra conta'}</small></div></div>
                <div className="person-balance"><span>Saldo individual</span><strong className={member.balance < 0 ? 'negative-balance' : ''}>{currency.format(member.balance)}</strong></div>
                <div className="person-breakdown"><span><i className="income-mark"><ArrowDownLeft size={14}/></i><span>Entrou<small>{currency.format(member.income)}</small></span></span><span><i className="expense-mark"><ArrowUpRight size={14}/></i><span>Saiu<small>{currency.format(member.expense)}</small></span></span></div>
              </article>)}
            </div>
          </section>

          {monthTransactions.length === 0 ? <section className="panel first-entry">
            <div className="first-entry-art"><span>♡</span></div><p className="eyebrow">UM COMEÇO TRANQUILO</p><h2>Este mês ainda está em branco.</h2><p>Anote primeiro o que vocês receberam. Depois, registre cada gasto conforme ele acontecer.</p><button className="primary-btn" onClick={() => setIsModalOpen(true)}><Plus size={17} />Fazer a primeira anotação</button>
          </section> : <section className="dashboard-grid intimate-grid">
            <article className="panel chart-panel"><div className="panel-heading"><div><h2>O mês tomando forma</h2><p>Acumulado do que entrou e saiu</p></div><div className="legend"><span><i className="dot green-dot" />Entrou</span><span><i className="dot orange-dot" />Saiu</span></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}><defs><linearGradient id="income" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#70c5a3" stopOpacity={0.22}/><stop offset="95%" stopColor="#70c5a3" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#2b2138"/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill:'#9c91a8', fontSize:12 }}/><Tooltip formatter={(value) => currency.format(Number(value))} contentStyle={{ borderRadius:12, border:'1px solid #382b48', background:'#1b1426', color:'#f4eff8' }}/><Area type="monotone" dataKey="receitas" stroke="#70c5a3" strokeWidth={2.5} fill="url(#income)"/><Area type="monotone" dataKey="despesas" stroke="#f19a79" strokeWidth={2.5} fill="transparent"/></AreaChart></ResponsiveContainer></div></article>
            <article className="panel category-panel"><div className="panel-heading"><div><h2>Para onde foi</h2><p>Gastos por categoria</p></div></div>{categoryTotals.length ? <div className="category-list">{categoryTotals.map(([name, value]) => <div key={name}><span>{name}</span><strong>{currency.format(value)}</strong><i><b style={{ width: `${totals.expense ? value / totals.expense * 100 : 0}%` }}/></i></div>)}</div> : <div className="soft-empty">Quando houver gastos, eles aparecem aqui.</div>}</article>
          </section>}
        </>}

        <section className={`panel transactions-panel ${showAll ? 'all-transactions' : ''}`}>
          <div className="panel-heading transactions-heading"><div><h2>{showAll ? 'Cada coisinha' : 'Últimas anotações'}</h2><p>{filteredTransactions.length ? `${filteredTransactions.length} ${filteredTransactions.length === 1 ? 'anotação' : 'anotações'} neste mês` : 'Nada anotado neste mês'}</p></div>{!showAll && filteredTransactions.length > 4 && <button className="text-button" onClick={() => setShowAll(true)}>Ver todas <ChevronRight size={16}/></button>}</div>
          <div className="filters"><label className="search"><Search size={18}/><input aria-label="Pesquisar" placeholder="Procurar uma anotação..." value={query} onChange={(e) => setQuery(e.target.value)}/></label><label className="select-wrap"><select aria-label="Filtrar" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}><option value="all">Tudo</option><option value="income">O que entrou</option><option value="expense">O que saiu</option></select><ChevronDown size={16}/></label></div>
          <div className="transaction-list">{filteredTransactions.slice(0, showAll ? undefined : 4).map((item) => { const meta = categoryMeta[item.category] ?? categoryMeta.Outros; const Icon = meta.icon; return <div className={`transaction ${deletingId === item.id ? 'transaction--deleting' : ''}`} key={item.id}><span className="transaction-icon" style={{ color:meta.color, background:meta.soft }}><Icon size={19}/></span><div className="transaction-info"><strong>{item.title}</strong><span>{item.category} · {item.owner}</span></div><time>{shortDate.format(new Date(`${item.date}T12:00:00`))}</time><strong className={item.type === 'income' ? 'amount income' : 'amount'}>{item.type === 'income' ? '+' : '−'} {currency.format(item.amount)}</strong><button className="delete-transaction" disabled={deletingId === item.id} aria-label={`Excluir ${item.title}`} title="Excluir anotação" onClick={() => deleteTransaction(item)}><Trash2 size={16}/></button></div>})}{!filteredTransactions.length && <div className="no-results">{query ? 'Nenhuma anotação combina com a busca.' : 'As anotações de vocês vão aparecer aqui.'}</div>}</div>
        </section>
      </div>
    </main>

    <button className="mobile-add" aria-label="Nova anotação" onClick={() => setIsModalOpen(true)}><Plus /></button>
    {isModalOpen && <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setIsModalOpen(false)}><section className="modal intimate-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><p className="eyebrow">UMA COISINHA DE CADA VEZ</p><h2 id="modal-title">O que aconteceu?</h2></div><button className="icon-btn" aria-label="Fechar" onClick={() => setIsModalOpen(false)}><X/></button></div><form onSubmit={addTransaction}><div className="type-choice"><label><input type="radio" name="type" value="expense" defaultChecked/><span><ArrowUpRight size={17}/>Saiu</span></label><label><input type="radio" name="type" value="income"/><span><ArrowDownLeft size={17}/>Entrou</span></label></div><label>Como vocês querem lembrar disso?<input name="title" required autoFocus placeholder="Ex.: almoço, salário, mercado..."/></label><div className="form-grid"><label>Quanto?<input name="amount" required min="0.01" step="0.01" type="number" inputMode="decimal" placeholder="R$ 0,00"/></label><label>Quando?<input name="date" required type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label></div><label>Categoria<select name="category" required><option value="">Escolha uma categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setIsModalOpen(false)}>Agora não</button><button className="primary-btn" type="submit">Guardar anotação</button></div></form></section></div>}
  </div>
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(''); setMessage('')
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email')); const password = String(data.get('password')); const name = String(data.get('name') ?? '').trim()
    const result = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options:{ data:{ full_name:name } } })
    if (result.error) setError(result.error.message.includes('Apenas duas') ? 'Este espaço já pertence a duas pessoas.' : result.error.message)
    else if (mode === 'signup' && !result.data.session) setMessage('Pronto! Abra seu e-mail para confirmar a conta.')
    setLoading(false)
  }
  return <main className="auth-page intimate-auth"><section className="auth-visual"><div className="auth-brand"><span className="brand__mark"><Heart size={20} fill="currentColor"/></span>Nosso Caixa</div><div className="auth-copy"><span>UM CANTINHO PARA DOIS</span><h1>Cuidar do dinheiro também é cuidar dos planos.</h1><p>Só vocês dois, o que entrou, o que saiu e tudo aquilo que querem construir juntos.</p></div><div className="auth-quote"><Heart size={18} fill="currentColor"/><p>Privado, simples e de vocês.</p></div></section><section className="auth-form-side"><div className="auth-card"><p className="eyebrow">{mode === 'login' ? 'QUE BOM TER VOCÊ DE VOLTA' : 'UMA DAS DUAS PESSOAS'}</p><h2>{mode === 'login' ? 'Entre no espaço de vocês' : 'Como podemos chamar você?'}</h2><p>{mode === 'login' ? 'Use a conta que vocês criaram aqui.' : 'Apenas duas contas podem fazer parte deste espaço.'}</p><form onSubmit={submit}>{mode === 'signup' && <label>Seu nome<input name="name" required maxLength={40} autoComplete="name" placeholder="O nome que você usa"/></label>}<label>Seu e-mail<input name="email" required type="email" autoComplete="email" placeholder="seu@email.com"/></label><label>Sua senha<input name="password" required minLength={6} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Pelo menos 6 caracteres"/></label>{error && <div className="form-message error">{error}</div>}{message && <div className="form-message success">{message}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Só um instante...' : mode === 'login' ? 'Entrar' : 'Criar minha conta'}</button></form><button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'É uma das duas pessoas? Criar conta' : 'Já tem conta? Entrar'}</button></div></section></main>
}

export default App
