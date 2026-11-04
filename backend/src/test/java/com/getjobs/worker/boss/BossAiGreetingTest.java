package com.getjobs.worker.boss;

import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class BossAiGreetingTest {
    private static final String FALLBACK = "您好，我对贵司的岗位很感兴趣。结合岗位要求和我目前的求职方向，希望有机会进一步了解团队工作内容，并介绍相关个人经历。感谢您阅读，期待后续沟通。";

    @Test
    void acceptsInclusiveLengthBoundaries() {
        assertTrue(Boss.isGreetingLengthValid("甲".repeat(50)));
        assertTrue(Boss.isGreetingLengthValid("甲".repeat(80)));
        assertFalse(Boss.isGreetingLengthValid("甲".repeat(49)));
        assertFalse(Boss.isGreetingLengthValid("甲".repeat(81)));
    }

    @Test
    void countsUnicodeCodePointsAndDoesNotSplitSurrogatePairs() {
        String message = "😀".repeat(50);
        assertTrue(Boss.isGreetingLengthValid(message));
        String longMessage = "😀".repeat(81);
        String truncated = Boss.truncateGreeting(longMessage);
        assertEquals(80, truncated.codePointCount(0, truncated.length()));
        assertFalse(Character.isHighSurrogate(truncated.charAt(truncated.length() - 1)));
    }

    @Test
    void shortGreetingRetriesOnceAndUsesExpandedResult() {
        AtomicInteger calls = new AtomicInteger();
        String expanded = "您好，我对贵司发布的Java岗位很感兴趣。我的经历与岗位要求有较好的匹配，希望有机会进一步沟通并介绍相关项目经验，感谢您阅读，期待回复。";
        var decision = Boss.enforceAiGreetingLength("3年Java，熟Spring Cloud/Redis/ES", () -> {
            calls.incrementAndGet();
            return expanded;
        }, FALLBACK);
        assertFalse(decision.skipCurrentJob());
        assertEquals(expanded, decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
        assertEquals(1, calls.get());
    }

    @Test
    void falseOnRetryUsesSafeFallbackInsteadOfSkippingJob() {
        var decision = Boss.enforceAiGreetingLength("太短", () -> "false", FALLBACK);
        assertFalse(decision.skipCurrentJob());
        assertEquals(FALLBACK, decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
    }

    @Test
    void stillShortAfterOneRetryUsesSafeFallback() {
        AtomicInteger calls = new AtomicInteger();
        var decision = Boss.enforceAiGreetingLength("3年Java，熟Spring Cloud/Redis/ES", () -> {
            calls.incrementAndGet();
            return "擅长Java开发，熟悉Redis。";
        }, FALLBACK);
        assertFalse(decision.skipCurrentJob());
        assertEquals(FALLBACK, decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
        assertEquals(1, calls.get());
    }

    @Test
    void longGreetingTruncatesAtSentenceBoundaryWhenPossible() {
        String input = "甲".repeat(53) + "。" + "乙".repeat(40);
        var decision = Boss.enforceAiGreetingLength(input, () -> fail("long output must not retry"), FALLBACK);
        assertFalse(decision.skipCurrentJob());
        assertEquals("甲".repeat(53) + "。", decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
    }

    @Test
    void longGreetingWithoutSentenceBoundaryTruncatesAtCodePointLimit() {
        String input = "甲".repeat(81);
        var decision = Boss.enforceAiGreetingLength(input, () -> fail("long output must not retry"), FALLBACK);
        assertEquals(80, decision.message().codePointCount(0, decision.message().length()));
    }

    @Test
    void falseResponseStillSkipsWithoutRetry() {
        AtomicInteger calls = new AtomicInteger();
        var decision = Boss.enforceAiGreetingLength("false", () -> {
            calls.incrementAndGet();
            return FALLBACK;
        }, FALLBACK);
        assertTrue(decision.skipCurrentJob());
        assertNull(decision.message());
        assertEquals(0, calls.get());
    }

    @Test
    void retryExceptionUsesSafeLengthBoundedFallback() {
        var decision = Boss.enforceAiGreetingLength("短", () -> { throw new RuntimeException("offline"); }, "短的旧配置");
        assertFalse(decision.skipCurrentJob());
        assertEquals(FALLBACK, decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
    }

    @Test
    void shortConfiguredFallbackUsesSafeLengthBoundedFallback() {
        var decision = Boss.enforceAiGreetingLength("简短结果", () -> { throw new RuntimeException("offline"); }, "用户配置的默认问候语");
        assertFalse(decision.skipCurrentJob());
        assertEquals(FALLBACK, decision.message());
        assertTrue(Boss.isGreetingLengthValid(decision.message()));
    }

    @Test
    void defaultFallbackGreetingIsWithinRequiredLength() {
        assertTrue(Boss.isGreetingLengthValid(FALLBACK));
    }

    @Test
    void stripsCodeFenceAndOuterQuotesBeforeMeasuring() {
        String message = "甲".repeat(50);
        assertEquals(message, Boss.normalizeAiGreeting("```text\n\"" + message + "\"\n```"));
        assertTrue(Boss.isGreetingLengthValid(Boss.normalizeAiGreeting("“" + message + "”")));
    }
}
