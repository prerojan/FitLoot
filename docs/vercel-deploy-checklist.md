# Deploy Vercel (Frontend) + Worker (Cloudflare)

## Variáveis de ambiente (Vercel)

- `VITE_API_URL`
  - Uso: URL base do backend no frontend (`src/react-app/utils/api.ts`).
  - Tipo: pública (prefixo `VITE_`).
  - Exemplo produção: `https://fitloot-worker.suportefitloot.workers.dev`

## CORS no Worker

- Produção já permitida:
  - `https://fitloot.vercel.app`
- Preview suportado por padrão:
  - `https://fitloot-*.vercel.app`
- Origens extras:
  - configurar `FRONTEND_ORIGIN` ou `FRONTEND_ORIGINS` (separadas por vírgula) no Cloudflare.

## Checklist

### Pré-deploy

- [ ] `vercel.json` presente e válido.
- [ ] `VITE_API_URL` definido no Vercel.
- [ ] Build local: `npm run build`.
- [ ] Worker publicado no Cloudflare.

### Painel Vercel

- [ ] Conectar repositório.
- [ ] Confirmar `Build Command`: `npm run build`.
- [ ] Confirmar `Output Directory`: `dist`.
- [ ] Adicionar variável `VITE_API_URL`.
- [ ] Executar deploy.

### Pós-deploy

- [ ] Login.
- [ ] Dashboard.
- [ ] Missões.
- [ ] Chat IA.
- [ ] Câmera/Análise de alimentos.
- [ ] Sem erros de CORS.
