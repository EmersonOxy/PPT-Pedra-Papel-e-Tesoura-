# Sistema visual modular de cartas

## Assets de origem

Os PNGs foram obtidos da conversa “PPT - Orquestrador Geral” e copiados sem reprocessamento para `src/assets/card-system/`:

- `frame.png`: moldura original, 1008 × 1408, RGBA com transparência real nas áreas centrais.
- `background-red.png`, `background-green.png`, `background-blue.png`, `background-purple.png` e `background-yellow.png`: fundos originais, 1008 × 1408.
- `card-back.png`: verso original de carta, usado inteiro no deck e nas cartas de sigilo ocultas.
- `trinity-crystals-source.png`: folha original dos cristais, preservada como referência.
- `sigil-green.png`, `sigil-purple.png` e `sigil-orange.png`: recortes dos três símbolos coloridos da folha; o cristal neutro não foi incluído como um dos três símbolos coloridos.

Todos os arquivos mantêm a proporção 63:88 da moldura. O fundo amarelo está disponível como quinta opção visual independente das regras; atualmente foi aplicado apenas à configuração provisória de `veil-oracle` para demonstrar seu uso. O verso é a arte original completa e substitui a composição CSS provisória.

## Como a carta é composta

`src/ui/card-presentation.ts` é a configuração e o componente visual reutilizável. `renderCardFace` é usado na mão, no campo, na prévia ampliada e, por consequência, durante o arraste físico da mesma carta. A ordem das camadas é:

1. Fundo colorido cobrindo a proporção completa da carta (vermelho, verde, azul, roxo ou amarelo).
2. Ilustração provisória contida na área central, sem recorte.
3. Cristal colorido no espaço superior direito.
4. Nome, números e descrição como texto HTML dinâmico.
5. `frame.png`, cujo canal alfa deixa as camadas inferiores visíveis.

As posições usam percentuais da tela 63:88: título em `left 8% / top 4.1%`, ilustração em `left 8% / top 13% / width 84% / height 49%`, indicadores em `top 66.2%`, descrição em `top 79%` e cristal sobre a referência da moldura em `right 0% / top 7.8% / width 15.5% / height 16%`, com deslocamento de `-10.6%` na horizontal e `3.3%` na vertical, relativo à própria imagem, e escala `1.08`. O deslocamento horizontal incorpora um ajuste adicional de cerca de 1 px para a esquerda em relação à calibragem anterior, escalando com a carta nos outros contextos.

## Dados e novas cartas

Os dados competitivos permanecem em `src/game/cards.ts` e `src/game/types.ts`. Nome, descrição, custo, ataque, vida máxima, tipo e efeito ficam no catálogo de jogo. Motivo provisório, fundo e cristal ficam em `cardPresentationCatalog`, no módulo visual. Adicionar uma carta exige criar os dados do jogo e uma entrada visual com `background`, `sigil` e `illustration`; faltando uma entrada, o renderer falha explicitamente.

- Tropas: círculo azul recebe ataque base do catálogo; círculo vermelho recebe vida atual da instância e acompanha dano.
- Feitiços: círculos apresentam custo experimental e valor de dano ou cura já definido na configuração do jogo.
- Sigilos: apresentam custo; o segundo atributo fica vazio e recebe uma descrição acessível, porque ainda não existe outro atributo definido.
- Descrição é simplificada na mão e no campo, e completa na prévia ampliada.
- Cartas sem arte própria exibem o motivo vetorial existente com o rótulo “Ilustração provisória”.

A configuração visual atual não está ligada a regras ou fundamentos de combate. Para trocar fundo ou símbolo, altere somente o registro da carta em `cardPresentationCatalog`. O verso usa `card-back.png` pelos renderers dedicados `renderDeckCardBack` e `renderCardBack`. Não há editor de artes próprias nem catálogo externo conectado nesta etapa.

## Limitações

As ilustrações atuais são provisórias. O frame já contém um cristal neutro; os cristais coloridos são sobrepostos no mesmo espaço sem alterar o PNG original. A distribuição web incluirá apenas imagens importadas pelo renderer. Assets antigos do placeholder permanecem no repositório, mas deixam de ser usados nas faces e nos sigilos ocultos.
