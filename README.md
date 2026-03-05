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

5. Preparar variáveis locais do Worker (sem commitar secrets)
```bash
cp .dev.vars.example .dev.vars
# Preencha .dev.vars com suas chaves locais antes de rodar wrangler dev
```

🧪 Testes

1. Instale as dependências:
```bash
npm ci
```

2. Rode os checks automatizados completos (dependem de instalação de dependências):
```bash
npm test
```

2.1. Se estiver em ambiente sem acesso ao npm, rode validação estática leve (padrão para ambiente AI):
```bash
npm run check:lite
```

Alias de validação padrão leve:
```bash
npm run validate
```

2.2. Alias explícito para ambiente AI:
```bash
npm run ai:check
```

3. (Opcional) Rode também a validação de deploy do worker:
```bash
npm run test:worker
```

### Setup guiado de ambiente para testes (manual)

`setup:test-env` é **manual** e não é executado automaticamente por scripts de desenvolvimento, hooks ou CI deste repositório.

Use apenas quando quiser tentar instalação de dependências:

```bash
npm run setup:test-env
```

Se sua rede for restrita, prefira validação leve:

```bash
npm run check:lite
```

### Variáveis de ambiente para setup manual

- `NPM_REGISTRY_URL` (opcional): sobrescreve o registry npm (padrão: `https://registry.npmjs.org/`).
- `NPM_REQUIRE_AUTH` (opcional): quando `true`, obriga validação de autenticação via `npm whoami`.
- `NPM_TOKEN` (obrigatória somente com `NPM_REQUIRE_AUTH=true`): token para registry privado.
- `NPM_ALLOW_PING_FAILURE` (opcional, padrão `true`): continua o setup mesmo se `npm ping` falhar em redes restritas.

Exemplo (somente execução manual):

```bash
NPM_REGISTRY_URL=https://<seu-registry-interno> NPM_REQUIRE_AUTH=true NPM_TOKEN=<seu-token> npm run setup:test-env
```

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


## Configuração de ambiente do Worker

Este projeto usa **ambiente padrão único** do Wrangler (sem `--env`), de acordo com os scripts existentes em `package.json` (`wrangler dev --local` e `wrangler deploy`).

Cadastre os secrets no ambiente padrão:

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put USDA_API_KEY
wrangler secret put GOOGLE_CLOUD_VISION_KEY
wrangler secret put ANTHROPIC_API_KEY
```

Healthcheck rápido do Worker:

```bash
curl http://localhost:8787/health
```


### Inicializar D1 local (evita erro `no such table` no `wrangler dev --local`)

Se aparecer erro como `D1_ERROR: no such table: users`, aplique as migrations no banco local do Worker:

```bash
wrangler d1 execute fitloot-db --local --file migrations/001_fitloot_schema.sql
wrangler d1 execute fitloot-db --local --file migrations/002_auth_tables.sql
wrangler d1 execute fitloot-db --local --file migrations/003_add_plan_to_users.sql
wrangler d1 execute fitloot-db --local --file migrations/004_add_password_salt_if_missing.sql
wrangler d1 execute fitloot-db --local --file migrations/005_onboarding_flag.sql
```

Depois reinicie o worker local e valide:

```bash
curl http://localhost:8787/health
```
