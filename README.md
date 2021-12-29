# drifting-rate
> Thanks to [chenwainuo/drifting-mango](https://github.com/chenwainuo/drifting-mango) for the bot

Funding rate arbitrage on https://mango.markets and https://drift.trade

Good guide on perps [here](https://www.paradigm.xyz/2021/03/the-cartoon-guide-to-perps/) 

### Strategy 
- When `mark-index` is (+) on Mango and (-) on Drift, longs pay shorts on mango and shorts pay longs on drift. Short 1 unit on mango and long 1 unit on drift to capture the funding rate and have neutral exposure
- When `mark-index` is (-) on Mango and (+) on Drift, longs pay shorts on drift and shorts pay longs on mango. Short 1 unit on drift and long 1 unit on mango to capture the funding rate and have neutral exposure
- When both funding rates are in the same direction, do not open a position unless you can hedge with another market (for example bonfia), additionally you could purchase options (potentially [https://01.xyz/](https://01.xyz/))

Majority of this bot was prewritten, working on the following additions

- [ ] Abstraction to any perp market
- [x] Log current PnL
- [ ] Account for fees 
- [ ] Integrate telegram bot to post pnl and commands to close all ([might be a good start](https://github.com/v0idum/solana_tracker_bot))
- [ ] Add in other exchanges like [bonfida](https://bonfida.org/)
- [ ] Central Accounting System 
- [ ] Handle Liquidators
- [x] Add in liquidators for each integration
- [ ] Report PNL %
- [x] Report Delta Exposure
- [ ] Dump to Database

## Running 
1. Edit the `.env.example` to fit with your parameters

| Variable          | Description                                           |
| ----------------- | ----------------------------------------------------- |
| THRESHOLD         | % differences between markets to initiate a position. |
| POSITION_SIZE_USD | size for each position                                |
| MAX_POSITION_SIZE | Max position size before going reduce only mode       |
| PRIVATE_KEY       | Private key array                                     |
| RPC_ADDRESS       | RPC address                                           |
| NETWORK           | Network you are running like 'mainnet-beta'           |

2. Start the Bot 
```
# via docker 
## drift liq, mango liq, and drift-mango arb
docker-compose up -d 

# drift liq only 
docker-compose up -d drift-liq 

# mango liq only 
docker-compose up -d mango-liq

# drift-mango arb only 
docker-compose up -d drift-arb

# via typescript 
npx ts-node drift-arb
npx ts-node drift-liq
npx ts-node mango-liq
```
