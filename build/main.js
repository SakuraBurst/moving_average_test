"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
let ccxt = require('ccxt');
const apiKey = process.env.API_KEY;
const secretKey = process.env.SECRET_KEY;
const botToken = process.env.BOT_TOKEN;
const bot = new node_telegram_bot_api_1.default(botToken);
const chatId = "-1001986131150";
const config = {
    timeframe: '15m',
    howMuchICanSpendInDay: 10.1,
    rsiPeriod: 10,
    bollingerPeriod: 20,
    bollingerMultiplier: 2,
};
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const binance = new ccxt.binance({
    apiKey,
    secret: secretKey,
});
class Position {
    constructor(symbol, crypto, buyPrice, amount) {
        this.stopLossPercentage = 0.95; // Значение стоп-лосса (5%)
        if (amount === undefined) {
            throw new Error('amount is undefined');
        }
        this.symbol = symbol;
        this.buyPrice = buyPrice;
        this.amount = amount;
        this.crypto = crypto;
        this.minSellPrice = buyPrice * (1 + fees[symbol]);
    }
    checkStopLoss() {
        return __awaiter(this, void 0, void 0, function* () {
            const ticker = yield binance.fetchTicker(this.symbol);
            const currentPrice = ticker.last;
            const prices = yield preparePrices(this.symbol, this.crypto, ticker);
            if (prices.balanceCrypto < prices.d10) {
                return true;
            }
            console.log(this);
            console.log({ currentPrice, ticker });
            if (currentPrice <= this.buyPrice * this.stopLossPercentage) {
                try {
                    console.log('Стоп-лосс срабатывает, продавать');
                    console.log(this);
                    let order = yield binance.createMarketSellOrder(this.symbol, this.amount);
                    console.log(order);
                    yield sendTelegramMessage(`Бот сделал стоплосс на цене ${currentPrice} и продал ${this.amount}${this.crypto}`);
                }
                catch (e) {
                    yield sendTelegramMessage(e.message);
                }
                return true;
            }
            return false;
        });
    }
}
class Positions {
    constructor() {
        this.positions = [];
    }
    findAllPositionsBySymbol(symbol) {
        return this.positions.filter(a => a.symbol === symbol);
    }
    findAllPositionsByLowestPrice(symbol, ticker) {
        return this.findAllPositionsBySymbol(symbol).filter(a => ticker.last >= a.minSellPrice);
    }
    calculateSellPriceByPositions(symbol, ticker) {
        return __awaiter(this, void 0, void 0, function* () {
            const pos = this.findAllPositionsByLowestPrice(symbol, ticker);
            console.log('calculateSellPriceByPositions ', pos);
            console.log('this.positions ', this.positions);
            let amount = 0;
            for (let i = 0; i < pos.length / 2; i++) {
                amount += pos[i].amount;
                this.deletePositionsByAmountAndSymbol(symbol, pos[i].amount);
            }
            return yield safeAmountToPrecision(symbol, amount);
        });
    }
    deletePositionsByAmountAndSymbol(symbol, amount) {
        const index = this.positions.findIndex((a) => a.symbol === symbol && a.amount === amount);
        if (index === -1) {
            return;
        }
        this.positions.splice(index, 1);
    }
    stopLossService(interval) {
        setInterval(() => {
            this.checkPositions();
        }, interval);
    }
    checkPositions() {
        return __awaiter(this, void 0, void 0, function* () {
            for (let i = 0; i < this.positions.length; i++) {
                const position = this.positions[i];
                const isStopLossTriggered = yield position.checkStopLoss();
                if (isStopLossTriggered) {
                    this.positions.splice(i, 1);
                    i--;
                }
            }
        });
    }
    setPosition(position) {
        this.positions.push(position);
    }
}
let positions = new Positions();
let cryptos = [
    { symbol: 'BTC/USDT', crypto: "BTC" },
    { symbol: 'ETH/USDT', crypto: "ETH" },
    { symbol: 'BNB/USDT', crypto: "BNB" },
    { symbol: 'SOL/USDT', crypto: "SOL" },
    { symbol: 'LTC/USDT', crypto: "LTC" },
];
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        positions.stopLossService(1000 * 60 * 2);
        yield calculateFees(...cryptos);
        let i = 0;
        let timeout = (1000 * 60 * 15) / cryptos.length;
        while (true) {
            console.log(new Date().toLocaleString());
            yield checkCrypto(cryptos[i].symbol, cryptos[i].crypto);
            i++;
            i = i % cryptos.length;
            yield sleep(timeout);
        }
    });
}
const fees = {};
function calculateFees(...cryptos) {
    return __awaiter(this, void 0, void 0, function* () {
        yield binance.loadMarkets();
        for (const crypto of cryptos) {
            fees[crypto.symbol] = binance.market(crypto.symbol).taker * 2;
        }
    });
}
function checkCrypto(symbol, crypto) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const historicalOHLCV = yield binance.fetchOHLCV(symbol, config.timeframe);
            const rsi = calculateRSI(historicalOHLCV, config.rsiPeriod);
            const [lowerBB, middleBB, upperBB] = calculateBollingerBands(historicalOHLCV, config.bollingerPeriod, config.bollingerMultiplier);
            const ticker = yield binance.fetchTicker(symbol);
            const prices = yield preparePrices(symbol, crypto, ticker);
            let rsiLog = "RSI:";
            let bbLog = "BB: ";
            rsiLog += rsi <= 30 ? " Покупать" : rsi > 70 ? " Продавать" : " Сидеть";
            bbLog += ticker.last <= lowerBB ? " Покупать" : ticker.last > upperBB ? " Продавать" : " Сидеть";
            console.log(`Your balance in ${symbol}: ${prices.balanceCrypto}/${prices.balanceUSDT}|${rsiLog} | ${bbLog} | RSI: ${rsi}, Lower BB: ${lowerBB}, Middle BB: ${middleBB}, Upper BB: ${upperBB}`);
            if (rsi <= 30 && ticker.last <= lowerBB && prices.balanceUSDT > 10.5) {
                console.log('Покупать');
                let order = yield binance.createMarketBuyOrder(symbol, prices.toBuy);
                positions.setPosition(new Position(symbol, crypto, prices.toBuy, ticker.last));
                yield sendTelegramMessage(`Бот купил ${prices.toBuy}${crypto} по цене ${ticker.last}`);
                console.log(order);
            }
            else if (rsi > 70 && ticker.last > upperBB && prices.balanceCrypto > prices.d10) {
                const toSell = yield positions.calculateSellPriceByPositions(symbol, ticker);
                console.log('Продавать');
                let order = yield binance.createMarketSellOrder(symbol, toSell);
                yield sendTelegramMessage(`Бот продал ${toSell}${crypto} по цене ${ticker.last}`);
                console.log(order);
            }
            else {
                console.log('Нет четкого сигнала, ожидайте');
            }
        }
        catch (e) {
            console.log(e);
        }
    });
}
function sendTelegramMessage(message) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield bot.sendMessage(chatId, message);
        }
        catch (error) {
            console.error(`Ошибка отправки сообщения в Telegram: ${error.message}`);
        }
    });
}
function calculateBollingerBands(ohlcData, period, multiplier) {
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
function calculateMovingAverage(ohlcData, period) {
    let sum = 0;
    let count = 0;
    for (let i = ohlcData.length - period; i < ohlcData.length; i++) {
        sum += ohlcData[i][4];
        count++;
    }
    return sum / count;
}
function preparePrices(symbol, crypto, ticker) {
    return __awaiter(this, void 0, void 0, function* () {
        const balance = yield binance.fetchBalance();
        const balanceCrypto = balance[crypto].free;
        const balanceUSDT = balance.USDT.free;
        yield binance.loadMarkets();
        const d10 = yield safeAmountToPrecision(symbol, 10.5 / ticker.last);
        const oneOfThirdUSDT = yield safeAmountToPrecision(symbol, balanceUSDT / 3 / ticker.last);
        const toBuy = Math.max(oneOfThirdUSDT, d10);
        return { toBuy, balanceCrypto, balanceUSDT, d10 };
    });
}
function safeAmountToPrecision(symbol, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return binance.amountToPrecision(symbol, amount);
        }
        catch (e) {
            return 0;
        }
    });
}
function calculateRSI(ohlcData, period) {
    let gains = 0;
    let losses = 0;
    for (let i = ohlcData.length - period - 1; i < ohlcData.length - 1; i++) {
        const change = ohlcData[i + 1][4] - ohlcData[i][4];
        if (change >= 0) {
            gains += change;
        }
        else {
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
