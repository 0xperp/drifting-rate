import { BN, Wallet } from '@project-serum/anchor';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
 calculateMarkPrice,
 ClearingHouse,
 initialize,
 Markets,
 PositionDirection,
 convertToNumber,
 calculateTradeSlippage,
 MARK_PRICE_PRECISION,
 QUOTE_PRECISION,
 IWallet,
 Market,
 DriftEnv, ClearingHouseUser,
} from '@drift-labs/sdk';

export default class DriftArbClient {
 connection: Connection;
 config: any;
 clearingHouse: ClearingHouse;
 wallet: Wallet;
 marketInfo: Market;
 marketIndex: BN;
 asset: string;
 publicKey: PublicKey;
 priceInfo = {
  longEntry: 0,
  shortEntry: 0
 };

 constructor(url: string, network: string, asset: string, connection: Connection, wallet: IWallet, POSITION_SIZE_USD, publicKey: PublicKey) {
  this.config = initialize({ env: network as DriftEnv });
  this.asset = asset;
  this.connection = new Connection(url);
  
  // Set up the Drift Clearing House
  const clearingHousePublicKey = new PublicKey(
   this.config.CLEARING_HOUSE_PROGRAM_ID
  );

  this.clearingHouse = ClearingHouse.from(
   connection,
   wallet,
   clearingHousePublicKey
  );
  this.publicKey = publicKey;
 }

 getLong(solMarketAccount, POSITION_SIZE_USD) {
  const formattedPrice = convertToNumber(calculateMarkPrice(this.marketInfo));
  let longSlippage = convertToNumber(
   calculateTradeSlippage(
    PositionDirection.LONG,
    new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
    solMarketAccount
   )[0],
   MARK_PRICE_PRECISION
  );
  return formattedPrice * (1 + longSlippage);
 }

 getShort(solMarketAccount, POSITION_SIZE_USD) {
  const formattedPrice = convertToNumber(calculateMarkPrice(this.marketInfo));
  let shortSlippage = convertToNumber(
   calculateTradeSlippage(
    PositionDirection.SHORT,
    new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
    solMarketAccount
   )[0],
   MARK_PRICE_PRECISION
  );
  return formattedPrice * (1 - shortSlippage);
 }

 async getPositionValue(): Promise<BN> {
  const user: ClearingHouseUser = this.getUser();

  await user.subscribe();
  await this.getMarket(this.asset);

  return user.getPositionValue(this.marketIndex);
 }

 async getPositionDirection(): Promise<number> {
  const user = this.getUser();
  await user.subscribe();
  if (user.getPositionSide(user.getUserPosition(this.marketIndex)) == PositionDirection.LONG) {
   return 1;
  }
  if (user.getPositionSide(user.getUserPosition(this.marketIndex)) == PositionDirection.SHORT) {
   return -1;
  }
 }

 async getPriceInfo(solMarketAccount, POSITION_SIZE_USD) {
  const marketInfo = await this.getMarket(this.asset);
  this.marketInfo = marketInfo;
  const short = this.getShort(solMarketAccount, POSITION_SIZE_USD);
  const long = this.getLong(solMarketAccount, POSITION_SIZE_USD);
  this.priceInfo.shortEntry = short;
  this.priceInfo.longEntry = long;
  return this.priceInfo;
 }

 async getMarket(asset: string): Promise<Market> {
  await this.clearingHouse.subscribe();
  const marketInfo = Markets.find(
   (market) => market.baseAssetSymbol === asset
  );

  this.marketIndex = marketInfo.marketIndex;

  return this.clearingHouse.getMarket(this.marketIndex);
 }

 getUser(): ClearingHouseUser {
  return ClearingHouseUser.from(this.clearingHouse, this.publicKey);
 }

 async getCanOpenDriftShort(user: ClearingHouseUser, MAX_POSITION_SIZE: number): Promise<boolean> {
  if (user.getPositionSide(user.getUserPosition(this.marketIndex)) == PositionDirection.LONG) {
   return true
  }
  return (convertToNumber(user.getPositionValue(this.marketIndex), QUOTE_PRECISION) < MAX_POSITION_SIZE)
 }

 async getCanOpenDriftLong(user: ClearingHouseUser, MAX_POSITION_SIZE: number): Promise<boolean> {
  if (user.getPositionSide(user.getUserPosition(this.marketIndex)) == PositionDirection.SHORT) {
   return true
  }
  return (convertToNumber(user.getPositionValue(this.marketIndex), QUOTE_PRECISION) < MAX_POSITION_SIZE)
 }

 async totalFeesPaid(): Promise<BN> {
  const user = this.getUser();
  await user.subscribe()
  return await user.clearingHouse.userAccount.totalFeePaid;
 }

 getUnrealizedPNL(user: ClearingHouseUser): number {
  return user.getUnrealizedPNL(true).toNumber() / 1000000
 }

 async openLongPosition(POSITION_SIZE_USD: number) {
  return (await this.clearingHouse.getOpenPositionIx(
   PositionDirection.LONG,
   new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
   this.marketIndex
  ));
 }

 async openShortPosition(POSITION_SIZE_USD: number): Promise<any> {
  return (await this.clearingHouse.getOpenPositionIx(
   PositionDirection.SHORT,
   new BN(POSITION_SIZE_USD).mul(QUOTE_PRECISION),
   this.marketIndex
  ));
 }

 async sendTxs(txn: Transaction) {
  await this.clearingHouse.txSender.send(txn, [], this.clearingHouse.opts).catch(t => {
   console.log("Transaction Failed: ", t)
  });
 }
}
