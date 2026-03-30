# Release Artifacts

Arquivos de release e saídas geradas localmente não devem ser versionados neste repositório.

Regras adotadas:

- APKs gerados localmente não ficam em `public/` nem em outras pastas rastreadas.
- Saídas de `dist-worker/` são tratadas como build local.
- Metadados locais do Android Studio e do Gradle ficam fora do Git.

Fluxo esperado:

- gerar APK, AAB e demais pacotes apenas no ambiente de build/release
- publicar artefatos em CI, release externa ou armazenamento dedicado
- manter no repositório apenas código-fonte, assets-fonte e documentação
