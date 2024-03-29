import {Ticker} from "ccxt";
import TelegramBot from "node-telegram-bot-api";

let ccxt = require('ccxt');

const apiKey = process.env.API_KEY
const secretKey = process.env.SECRET_KEY
const botToken = process.env.BOT_TOKEN
const bot= new TelegramBot(botToken)
const chatId = "-1001986131150"

const config = {
    timeframe: '15m',
    howMuchICanSpendInDay: 10.1,
    rsiPeriod: 10,
    bollingerPeriod: 20,
    bollingerMultiplier: 2,
};
let sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const binance = new ccxt.binance({
    apiKey,
    secret: secretKey,
});


class Position {
    symbol: string
    crypto: string
    buyPrice: number
    amount:number
    minSellPrice:number
    stopLossPercentage:number = 0.95// Значение стоп-лосса (5%)
    constructor(symbol:string, crypto: string, buyPrice: number, amount: number|undefined) {
        if (amount === undefined) {
            throw new Error('amount is undefined')
        }
        this.symbol = symbol;
        this.buyPrice = buyPrice;
        this.amount = amount;
        this.crypto = crypto
        this.minSellPrice = buyPrice * (1+ fees[symbol])
    }

    async checkStopLoss() {
        const ticker = await binance.fetchTicker(this.symbol);
        const currentPrice = ticker.last;
        const prices = await preparePrices(this.symbol, this.crypto, ticker)
        if (prices.balanceCrypto < prices.d10) {
            return true
        }
        console.log(this)
        console.log({currentPrice, ticker})
        if (currentPrice <= this.buyPrice * this.stopLossPercentage) {
            try {
                console.log('Стоп-лосс срабатывает, продавать');
                console.log(this)
                let order = await binance.createMarketSellOrder(this.symbol, this.amount);
                console.log(order);
                await sendTelegramMessage(`Бот сделал стоплосс на цене ${currentPrice} и продал ${this.amount}${this.crypto}`)
            }catch (e) {
                await sendTelegramMessage(e.message)
            }
            return true;
        }
        return false;
    }
}

class Positions {
    positions: Position[] = []

    private findAllPositionsBySymbol(symbol:string): Position[] {
        return this.positions.filter(a => a.symbol === symbol)
    }

    private findAllPositionsByLowestPrice(symbol:string, ticker: Ticker) {
        return this.findAllPositionsBySymbol(symbol).filter(a => ticker.last >= a.minSellPrice )
    }

    async calculateSellPriceByPositions(symbol: string, ticker:Ticker):Promise<number> {
        const pos = this.findAllPositionsByLowestPrice(symbol, ticker)
        console.log('calculateSellPriceByPositions ', pos)
        console.log('this.positions ', this.positions)
        let amount = 0
        for (let i = 0; i < pos.length/2; i++) {
            amount+=pos[i].amount
            this.deletePositionsByAmountAndSymbol(symbol, pos[i].amount)
        }
        return await safeAmountToPrecision(symbol, amount);
    }

    deletePositionsByAmountAndSymbol(symbol:string, amount:number):void{
        const index = this.positions.findIndex((a) => a.symbol === symbol && a.amount === amount)
        if (index === -1) {
            return
        }
        this.positions.splice(index, 1)
    }

    stopLossService(interval:number) {
        setInterval(() => {
            this.checkPositions()
        }, interval)
    }

    async checkPositions() {
        for (let i = 0; i < this.positions.length; i++) {
            const position = this.positions[i];
            const isStopLossTriggered = await position.checkStopLoss();
            if (isStopLossTriggered) {
                this.positions.splice(i, 1);
                i--;
            }
        }
    }


    setPosition(position: Position) {
        this.positions.push(position)
    }
}

let positions = new Positions()

type cryptoinfo =  {
    symbol: string
    crypto: string
}

let cryptos : cryptoinfo[] = [
    {symbol:'BTC/USDT', crypto:"BTC"},
    {symbol:'ETH/USDT', crypto:"ETH"},
    {symbol:'BNB/USDT', crypto:"BNB"},
    {symbol:'SOL/USDT', crypto:"SOL"},
    {symbol:'LTC/USDT', crypto:"LTC"},
]

async function main() {
    positions.stopLossService(1000 * 60 * 2)
    await calculateFees(...cryptos)
    let i :number = 0
    let timeout = (1000 * 60 * 15) / cryptos.length
    while (true) {
        console.log(new Date().toLocaleString())
        await checkCrypto(cryptos[i].symbol, cryptos[i].crypto)
        i++
        i = i % cryptos.length
        await sleep(timeout);
    }
}

const fees: { [k: string]: number } = {}

async function calculateFees(...cryptos:cryptoinfo[]):Promise<void> {
    await binance.loadMarkets();
    for (const crypto of cryptos) {
        fees[crypto.symbol] = binance.market(crypto.symbol).taker * 2
    }


}


async function checkCrypto(symbol:string, crypto:string):Promise<void> {
    try {
        const historicalOHLCV = await binance.fetchOHLCV(symbol, config.timeframe);
        const rsi = calculateRSI(historicalOHLCV, config.rsiPeriod);
        const [lowerBB, middleBB, upperBB] = calculateBollingerBands(historicalOHLCV, config.bollingerPeriod, config.bollingerMultiplier);
        const ticker = await binance.fetchTicker(symbol);
        const prices =  await preparePrices(symbol, crypto, ticker)
        let rsiLog = "RSI:"
        let bbLog = "BB: "
        rsiLog += rsi <= 30  ? " Покупать" : rsi > 70  ? " Продавать" : " Сидеть"
        bbLog += ticker.last <= lowerBB ? " Покупать" : ticker.last > upperBB ? " Продавать" : " Сидеть"
        console.log(`Your balance in ${symbol}: ${prices.balanceCrypto}/${prices.balanceUSDT}|${rsiLog} | ${bbLog} | RSI: ${rsi}, Lower BB: ${lowerBB}, Middle BB: ${middleBB}, Upper BB: ${upperBB}`);
        if (rsi <= 30 && ticker.last <= lowerBB && prices.balanceUSDT > 10.5) {
            console.log('Покупать');
            let order = await  binance.createMarketBuyOrder(symbol, prices.toBuy)
            positions.setPosition(new Position(symbol,crypto, prices.toBuy, ticker.last))
            await sendTelegramMessage(`Бот купил ${prices.toBuy}${crypto} по цене ${ticker.last}`)
            console.log(order)
        } else if (rsi > 70 && ticker.last > upperBB && prices.balanceCrypto > prices.d10) {
            const toSell = await positions.calculateSellPriceByPositions(symbol, ticker)
            console.log('Продавать');
            let order = await  binance.createMarketSellOrder(symbol, toSell)
            await sendTelegramMessage( `Бот продал ${toSell}${crypto} по цене ${ticker.last}`)
            console.log(order)
        } else {
            console.log('Нет четкого сигнала, ожидайте');
        }
    } catch (e) {
        console.log(e);
    }
}

async function sendTelegramMessage(message: string) {
    try {
        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error(`Ошибка отправки сообщения в Telegram: ${error.message}`);
    }
}

function calculateBollingerBands(ohlcData: number[][], period: number, multiplier: number): [number, number, number] {
    const sma = calculateMovingAverage(ohlcData, period);
    let sum = 0;

    for (let i = ohlcData.length - period; i < ohlcData.length; i++) {
        sum += Math.pow(ohlcData[i][4] - sma, 2);
    }

    const stdDeviation = Math.sqrt(sum / period);
    const upperBB = sma + stdDeviation * multiplier;
    const lowerBB = sma - stdDeviation * multiplier;

    return [lowerBB, sma, upperBB];
}
function calculateMovingAverage(ohlcData: number[][], period: number):number {
    let sum = 0;
    let count = 0;
    for (let i = ohlcData.length - period; i < ohlcData.length; i++) {
        sum += ohlcData[i][4];
        count++;
    }
    return sum / count;
}

async function preparePrices(symbol: string, crypto: string, ticker: Ticker): Promise<{balanceCrypto:number, balanceUSDT:number, toBuy: number, d10: number}> {
    const balance = await binance.fetchBalance();
    const balanceCrypto = balance[crypto].free;
    const balanceUSDT = balance.USDT.free;
    await binance.loadMarkets();
    const d10 = await safeAmountToPrecision(symbol, 10.5 / ticker.last);
    const oneOfThirdUSDT = await safeAmountToPrecision(symbol, balanceUSDT / 3 / ticker.last);
    const toBuy = Math.max(oneOfThirdUSDT, d10);
    return {toBuy, balanceCrypto, balanceUSDT, d10};
}
async function safeAmountToPrecision(symbol: string, amount: number): Promise<number> {
    try {
        return binance.amountToPrecision(symbol, amount);
    } catch (e) {
        return 0;
    }
}



function calculateRSI(ohlcData: number[][], period: number):number {
    let gains = 0;
    let losses = 0;
    for (let i = ohlcData.length - period - 1; i < ohlcData.length - 1; i++) {
        const change = ohlcData[i + 1][4] - ohlcData[i][4];
        if (change >= 0) {
            gains += change;
        } else {
            losses -= change;
        }
    }

    const averageGain = gains / period;
    const averageLoss = losses / period;

    const RS = averageGain / averageLoss;
    const RSI = 100 - 100 / (1 + RS);

    return RSI;
}

main().catch((error) => console.error("Error:", error));