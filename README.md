🏋️‍♂️ FitLoot – Gamificação Fitness

O FitLoot é um aplicativo que transforma seus hábitos saudáveis em uma experiência gamificada.
Complete missões, ganhe recompensas, evolua seu perfil e torne sua rotina fitness mais motivadora e divertida.

🚀 Tecnologias Utilizadas

React 19

Hono (API em Cloudflare Workers)

Cloudflare Pages + D1 Database

TailwindCSS

TypeScript

Zod (validações)

🛠️ Como Rodar o Projeto Localmente
1. Instalar dependências
npm install

2. Rodar o frontend
npm run dev

3. Rodar o backend (Cloudflare Worker)
npm run dev:worker

4. Rodar ambos ao mesmo tempo
npm run dev:all

📦 Build de Produção
npm run build

🌩️ Deploy (Cloudflare)
Worker (API):
wrangler deploy

Frontend (Pages):
wrangler pages deploy dist

📁 Estrutura Simplificada
/src
  /components
  /pages
  /worker (Hono API)
  App.tsx
  main.tsx

/public
/dist (build)

🔒 Autenticação Google OAuth

O FitLoot utiliza Google OAuth integrado ao Cloudflare Workers com cookies HttpOnly e sessões armazenadas em D1.

📬 Contato & Suporte

Em breve!