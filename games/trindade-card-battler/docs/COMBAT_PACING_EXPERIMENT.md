# Experimento de ritmo de combate

Estes valores são provisórios para playtest, não uma decisão de balanceamento final.

## Temporizadores

Antes, todas as tropas usavam o mesmo intervalo de **5.000 ms** entre ataques. Agora o intervalo base é **6.500 ms**, com multiplicadores por carta em `config/balance.experimental.json` para manter diferenças: técnica `0,92` (5.980 ms), impacto `1,00` (6.500 ms) e guarda `1,08` (7.020 ms). Os multiplicadores aplicam-se apenas à recarga, sem mudar o resultado ou a ordem de resolução de ataques simultâneos.

## Atributos usados no experimento

Para reduzir eliminações por um único golpe sem elevar todos os valores indiscriminadamente, ataque e resistência foram ajustados seletivamente:

| Carta | Antes (ataque/vida) | Experimento (ataque/vida) |
| --- | ---: | ---: |
| Guardiã Solene | 2/4 | 2/4 |
| Raposa Astral | 3/2 | 2/4 |
| Colosso de Musgo | 2/6 | 2/6 |
| Fênix de Âmbar | 5/2 | 3/4 |
| Oráculo do Véu | 3/3 | 2/4 |
| Lâmina Vesperal | 4/2 | 3/4 |
| Sentinela Prismática | 2/5 | 2/5 |
| Cavaleiro da Brasa | 4/3 | 3/4 |

As estatísticas de vida atuais são preservadas pelo motor ao dano; a apresentação lê o estado atual. Feitiços, vida dos jogadores, IA e regras de alvo não foram alterados.

## Medição

`tests/combat-pacing.test.ts` compara as 64 combinações direcionais de duelos 1 contra 1, coluna correspondente, com ataques simultâneos quando os instantes coincidem. A versão anterior é calculada com os atributos e intervalo de 5 s acima; a nova percorre o motor real e as recargas individuais. Essa métrica mede o instante da primeira eliminação, não partidas completas com IA, feitiços, defesa de coluna ou posicionamento.

## Apresentação

Os perfis `advance`, `impact`, `spin` e `pulse` são propriedades visuais das definições de tropa e só são consultados pelo renderer. As animações começam ao receber evento de ataque/dano; o motor não aguarda CSS. O campo usa inclinação de `1deg`; defina `--field-tilt-angle` e `--field-tilt-opponent-angle` como `0deg` em `src/ui/styles.css` para desativar.
