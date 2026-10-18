# Guia planejado do usuário — Trindade Studio

O Studio ainda não foi implementado. Este documento registra o fluxo esperado para o MVP e será atualizado quando a interface existir.

## Fluxo principal esperado

1. Abrir uma pasta de projeto existente e selecionar a tela/jogo.
2. Escolher um elemento no palco ou no painel de camadas.
3. Alterar somente as propriedades mostradas no inspetor, com limites e ajuda claros.
4. Alternar preview desktop/mobile, ajustar zoom e testar sem a interface do Studio.
5. Desfazer/refazer mudanças, salvar e abrir novamente para confirmar persistência.

## Organização da tela planejada

- **Camadas:** busca, grupos e nomes acessíveis; seleção sincronizada com o palco.
- **Palco:** jogo real em preview, indicação da seleção, alças autorizadas, grade e breakpoint ativo.
- **Propriedades:** texto, cor, fonte, asset, posição, dimensões e propriedades registradas do elemento.
- **Barra de ferramentas:** desfazer/refazer, viewport, zoom/ajustar, testar, salvar e estado dirty.

## Escopo inicial e limites

O MVP cobre um catálogo limitado de texto, imagem, HUD e botões registrados. Não oferece edição livre de código, HTML, CSS, DOM, keyframes ou telas arbitrárias. Ajustes de gameplay só aparecem em sandbox local; defaults competitivos não são editáveis no MVP.

## Feedback, acessibilidade e erros

- Navegação por teclado, foco visível, nomes de controles anunciados e indicação de seleção que não depende somente de cor.
- Respeitar zoom/reduced motion e manter alvos de interação confortáveis.
- Erros informam elemento, propriedade, valor esperado e como recuperar; não apagar configuração inválida.
- Ao fechar com mudanças pendentes, oferecer salvar, descartar ou cancelar.

## Testar e Git

Teste mostra resultados por etapa e abre o jogo apenas depois dos gates. Git mostra branch, diff e arquivos antes de stage; commit e push são decisões separadas, com confirmação adicional para `main`.
