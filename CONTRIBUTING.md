# Contribuindo

Obrigado pelo interesse em contribuir!

## Setup de Desenvolvimento

```bash
# Clone o repositório
git clone https://github.com/Chrispsz/naruto-online-launcher.git
cd naruto-online-launcher

# Instale as dependências
npm install

# Execute em modo de desenvolvimento
npm start

# Execute os testes
npm test

# Verifique o lint
npm run lint
```

## Estrutura do Projeto

```
src/
├── main.js           # Entry point
├── chromium/         # Flags do Chromium
├── config/           # Configurações (regiões, hardware)
├── flash/            # Detecção e configuração do Flash
├── network/          # Bloqueador e cookies
├── window/           # Interface e diálogos
└── utils/            # Utilitários (logger)
```

## Padrões de Código

- **ESLint + Prettier**: Obrigatório
- **Commits**: Em português ou inglês, descritivos
- **PRs**: Com descrição clara do que foi alterado

## Antes de Submeter

1. Execute `npm run lint` e corrija erros
2. Execute `npm test` e certifique-se que passam
3. Teste manualmente no Linux e/ou Windows

## Dúvidas

Abra uma [issue](https://github.com/Chrispsz/naruto-online-launcher/issues) com sua dúvida.
