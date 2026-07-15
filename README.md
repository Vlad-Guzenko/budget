# Мотофонд · дневной бюджет

Трекер, который каждый день пересчитывает, сколько можно потратить, чтобы дотянуть до зарплаты и максимально накопить. Vite + React + Supabase, деплой на Vercel.

## Как работает бюджет

- Бюджет `800 €` живыми деньгами на `45 дней` (по умолчанию, меняется в ⚙︎).
- Дневной лимит = остаток бюджета ÷ оставшиеся дни. **С переносом**: потратил меньше сегодня → завтрашний лимит выше.
- «Мотофонд» — прогноз накоплений к зарплате по твоему реальному темпу трат.
- Тикеты на еду и подушка 350 € в расчёт не входят.

## Запуск локально

```bash
npm install
cp .env.example .env      # впиши свои ключи Supabase
npm run dev
```

## Настройка Supabase

1. Создай проект на https://supabase.com
2. **SQL Editor → New query** → вставь содержимое `supabase-schema.sql` → **Run**.
   Создаст таблицы `entries`, `config` и включит RLS (каждый видит только свои данные).
3. **Project Settings → API** → скопируй `Project URL` и `anon public` ключ в `.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. **Authentication → Providers → Email**: для личного тула можно выключить
   "Confirm email", чтобы входить сразу без подтверждения почты.

## Деплой на Vercel

1. Залей проект в репозиторий GitHub.
2. https://vercel.com → **Add New → Project** → выбери репозиторий.
   Framework определится как **Vite** автоматически (build `npm run build`, output `dist`).
3. **Settings → Environment Variables** → добавь те же две переменные:
   `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**. Через минуту получишь URL.
5. На телефоне открой URL → «Поделиться» → «На экран Домой» — встанет как приложение (PWA).

## Первый вход

Открой сайт → «Создать аккаунт» → e-mail + пароль. Дальше сессия сохраняется,
данные синхронизируются между всеми твоими устройствами.

## Файлы

- `src/App.jsx` — вся логика: авторизация, расчёты, экраны.
- `src/supabase.js` — клиент Supabase из env-переменных.
- `supabase-schema.sql` — схема БД + RLS.
- `public/` — manifest, service worker, иконки (замени `icon-*.png` на свои при желании).
