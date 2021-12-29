import { Provider, Wallet } from '@project-serum/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import { wrapInTx } from "@drift-labs/sdk/lib/tx/utils";

import MangoArbClient from "./protocols/mango";
import DriftArbClient from "./protocols/drift";

const { printTable } = require('console-table-printer');

require('dotenv').config();
const THRESHOLD: number = +process.env.THRESHOLD;
const POSITION_SIZE_USD: number = +process.env.POSITION_SIZE_USD;
const MAX_POSITION_SIZE: number = +process.env.MAX_POSITION_SIZE;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_ADDRESS = process.env.RPC_ADDRESS;
const NETWORK = process.env.NETWORK;

let order_number = 0;

const main = async (ASSET: string) => {
    // Set up the Wallet and Provider
    const privateKey = PRIVATE_KEY
    const keypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(privateKey))
    );
    const wallet = new Wallet(keypair);

    // Set up the Connection
    const connection = new Connection(RPC_ADDRESS);
    // Set up the Provider
    const provider = new Provider(connection, wallet, Provider.defaultOptions());

    // Set up Mango
    const mangoArbClient = new MangoArbClient(RPC_ADDRESS, ASSET)
    await mangoArbClient.init(JSON.parse(privateKey))

    // Set up and init Drift 
    const driftArbClient = new DriftArbClient(RPC_ADDRESS, NETWORK, ASSET, connection,
        provider.wallet, POSITION_SIZE_USD, wallet.publicKey)

    console.log(`Initialized connection... \n Network: ${NETWORK}\n Trading Address: ${wallet.publicKey}\n Asset: ${ASSET}`)

    // set up drift user
    const driftUser = driftArbClient.getUser();
    await driftUser.subscribe();

    // Get current PNl and fees paid
    // const pnl = [
    //     {
    //         PnL: driftArbClient.getUnrealizedPNL(driftUser).add(mangoArbClient.getUnrealizedPNL()).toNumber(),
    //         // Fees: (await driftArbClient.totalFeesPaid()).add(mangoArbClient.totalFeesPaid()).toNumber(),
    //     }
    // ];
    // printTable(pnl);

    trade();

    async function trade() {
        // Get mango bids and asks to submit orders
        const mangoBid = await mangoArbClient.getTopAsk()
        const mangoAsk = await mangoArbClient.getTopBid()

        const solMarketAccount = await driftArbClient.getMarket(ASSET);
        const driftPriceInfo = await driftArbClient.getPriceInfo(solMarketAccount, POSITION_SIZE_USD);

        // Checking Opportunity
        const driftShortDiff = (driftPriceInfo.shortEntry - mangoAsk) / mangoAsk * 100
        const driftLongDiff = (mangoBid - driftPriceInfo.longEntry) / driftPriceInfo.longEntry * 100

        // Get current exposure across all assets and markets
        let driftExposure = (await driftArbClient.getPositionValue()).toNumber();
        const mangoExposure = mangoArbClient.getPositionValue();
        const driftDirection = (await driftArbClient.getPositionDirection()); // will return 1 or -1 to indicate directional exposure

        // since driftExposure is in notational divide by bid:ask avg to get position size
        driftExposure = (driftExposure / ((driftPriceInfo.shortEntry + driftPriceInfo.longEntry) / 2)) / 1000000;

        const delta = ((driftExposure * driftDirection) + (mangoExposure)); // need to add in direction
            
        const marketDiff = [
            {
                drift_short_entry: driftPriceInfo.shortEntry,
                drift_long_entry: driftPriceInfo.longEntry,
                mango_bid: mangoBid,
                mango_ask: mangoAsk,
                long_drift_short_mango: driftLongDiff.toFixed(4),
                short_drift_long_mango: driftShortDiff.toFixed(4),
                delta: delta.toFixed(4),
                PnL: driftArbClient.getUnrealizedPNL(driftUser) + mangoArbClient.getUnrealizedPNL(),
            }
        ];
        printTable(marketDiff);

        // Is MAX_POSITION_USD maxed or can more positions be opened
        let canOpenDriftLong = await driftArbClient.getCanOpenDriftLong(driftUser, MAX_POSITION_SIZE);
        let canOpenDriftShort = await driftArbClient.getCanOpenDriftShort(driftUser, MAX_POSITION_SIZE);

        // open drift long mango short
        // if short is maxed out, try to lower threshold to close the short open more long.
        let driftLongThreshold = canOpenDriftShort ? THRESHOLD : (0.2 * THRESHOLD)
        if (driftLongDiff > driftLongThreshold) {
            if (!canOpenDriftLong) {
                console.log(`Drift long exposure is > ${MAX_POSITION_SIZE}`)
                return
            }

            const trade = [
                {
                    order_number: order_number,
                    short_mango_size: POSITION_SIZE_USD,
                    short_mango_bid: mangoBid,
                    long_drift_size: POSITION_SIZE_USD,
                    long_drift_ask: driftPriceInfo.longEntry,
                    profit: driftLongDiff.toFixed(4),
                }
            ];
            printTable(trade);

            const quantity = POSITION_SIZE_USD / driftPriceInfo.longEntry

            // Open Drift Long and Mango Short
            const txn = wrapInTx(
                await driftArbClient.openLongPosition(MAX_POSITION_SIZE)
            )
            txn.add(mangoArbClient.marketShort(POSITION_SIZE_USD, mangoBid, quantity))
            driftArbClient.sendTxs(txn);

            order_number++;
        }

        // open mango short drift long
        // if long is maxed out, try to lower threshold to close the long by more short.
        let driftShortThreshold = canOpenDriftLong ? THRESHOLD : (0.2 * THRESHOLD)
        if (driftShortDiff > driftShortThreshold) {
            if (!canOpenDriftShort) {
                return
            }

            const trade = [
                {
                    order_number: order_number,
                    short_drift_size: POSITION_SIZE_USD,
                    short_drift_bid: driftPriceInfo.shortEntry,
                    long_mango_size: POSITION_SIZE_USD,
                    long_mango_ask: mangoAsk,
                    profit: driftShortDiff.toFixed(4),
                }
            ];
            printTable(trade);

            const quantity = POSITION_SIZE_USD / driftPriceInfo.shortEntry

            // Open Drift Short and Mango Long
            const txn = wrapInTx(
                await driftArbClient.openShortPosition(MAX_POSITION_SIZE)
            )
            txn.add(mangoArbClient.marketLong(POSITION_SIZE_USD, mangoBid, quantity))
            driftArbClient.sendTxs(txn);

            order_number++
        }
    }
    setInterval(trade, 4000) // setting interval for 4k ms
}

main('SOL')