import { test, expect, describe } from "bun:test";
import { detectCategory, generateTradeHash } from "../services/alert.service";

describe("alert.service", () => {
  describe("detectCategory", () => {
    describe("sports detection", () => {
      test("should detect NBA games", () => {
        expect(detectCategory("nba-lakers-vs-celtics", "Lakers vs Celtics")).toBe("sports");
      });

      test("should detect NFL games", () => {
        expect(detectCategory("nfl-chiefs-vs-eagles", "Chiefs vs Eagles")).toBe("sports");
      });

      test("should detect UFC fights", () => {
        expect(detectCategory("ufc-298-main-event", "UFC 298")).toBe("sports");
      });

      test("should detect vs. pattern", () => {
        expect(detectCategory("some-match", "Team A vs Team B")).toBe("sports");
        expect(detectCategory("some-match", "Team A vs. Team B")).toBe("sports");
      });
    });

    describe("politics detection", () => {
      test("should detect election markets", () => {
        expect(detectCategory("presidential-election-2024", "Presidential Election")).toBe("politics");
      });

      test("should detect Trump markets", () => {
        expect(detectCategory("trump-indictment", "Trump Indictment")).toBe("politics");
      });

      test("should detect Biden markets", () => {
        expect(detectCategory("biden-approval", "Biden Approval Rating")).toBe("politics");
      });
    });

    describe("crypto detection", () => {
      test("should detect Bitcoin markets", () => {
        expect(detectCategory("bitcoin-100k", "Bitcoin to $100k")).toBe("crypto");
      });

      test("should detect Ethereum markets", () => {
        expect(detectCategory("ethereum-price", "Ethereum Price")).toBe("crypto");
      });

      test("should detect BTC shorthand", () => {
        expect(detectCategory("btc-halving", "BTC Halving")).toBe("crypto");
      });

      test("should detect crypto keyword", () => {
        expect(detectCategory("crypto-regulation", "Crypto Regulation")).toBe("crypto");
      });
    });

    describe("other category", () => {
      test("should return other for unrecognized markets", () => {
        expect(detectCategory("weather-forecast", "Weather Forecast")).toBe("other");
        expect(detectCategory("movie-awards", "Oscar Winner")).toBe("other");
      });
    });
  });

  describe("generateTradeHash", () => {
    test("should generate consistent hash for same trade", () => {
      const trade = { transactionHash: "0x123", id: "456" } as any;
      const hash1 = generateTradeHash(trade);
      const hash2 = generateTradeHash(trade);
      expect(hash1).toBe(hash2);
    });

    test("should generate different hashes for different trades", () => {
      const trade1 = { transactionHash: "0x123", id: "456" } as any;
      const trade2 = { transactionHash: "0x789", id: "012" } as any;
      expect(generateTradeHash(trade1)).not.toBe(generateTradeHash(trade2));
    });

    test("should include both txHash and id", () => {
      const trade = { transactionHash: "0xabc", id: "def" } as any;
      const hash = generateTradeHash(trade);
      expect(hash).toBe("0xabc-def");
    });
  });
});
