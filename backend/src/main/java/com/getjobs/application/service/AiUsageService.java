package com.getjobs.application.service;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * AI 调用用量统计与预算闸门的公共数据层。
 *
 * <p>为什么单独抽出来：投递主流程（{@code Boss}）、简历解析、简历评估、面板上的
 * 「AI 润色」都走同一个 {@link AiService}，如果每处各自计数，用户在面板上看到的
 * 数字永远对不上账单。这里统一记录每一次成功调用：
 * <ul>
 *   <li>今日累计落到 {@code ai_usage_daily}（按天一行，重启不丢）；</li>
 *   <li>「本次运行」只存在内存里，投递开始时由 {@link #resetRun()} 清零。</li>
 * </ul>
 *
 * <p>表在启动时用 {@code CREATE TABLE IF NOT EXISTS} 建，老库不需要手工迁移。
 * 落库失败只降级为内存统计，绝不影响投递。
 */
@Service
public class AiUsageService {

    private static final Logger log = LoggerFactory.getLogger(AiUsageService.class);

    private final JdbcTemplate jdbc;

    private final AtomicInteger runCalls = new AtomicInteger();
    private final AtomicLong runPrompt = new AtomicLong();
    private final AtomicLong runCompletion = new AtomicLong();
    private final AtomicLong runTotal = new AtomicLong();

    public AiUsageService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void ensureTable() {
        try {
            jdbc.execute("""
                    CREATE TABLE IF NOT EXISTS ai_usage_daily (
                      day TEXT PRIMARY KEY,
                      calls INTEGER NOT NULL DEFAULT 0,
                      prompt_tokens INTEGER NOT NULL DEFAULT 0,
                      completion_tokens INTEGER NOT NULL DEFAULT 0,
                      total_tokens INTEGER NOT NULL DEFAULT 0,
                      updated_at TEXT
                    )
                    """);
        } catch (RuntimeException error) {
            log.warn("创建 ai_usage_daily 表失败，用量只在内存中统计: {}", error.getMessage());
        }
    }

    /**
     * 记录一次成功调用。
     *
     * @param promptTokens     输入 token，-1 表示上游没返回
     * @param completionTokens 输出 token，-1 表示上游没返回
     * @param totalTokens      总 token，-1 时用输入 + 输出兜底
     */
    public void record(int promptTokens, int completionTokens, int totalTokens) {
        int prompt = Math.max(promptTokens, 0);
        int completion = Math.max(completionTokens, 0);
        int total = totalTokens >= 0 ? totalTokens : prompt + completion;

        runCalls.incrementAndGet();
        runPrompt.addAndGet(prompt);
        runCompletion.addAndGet(completion);
        runTotal.addAndGet(total);

        try {
            jdbc.update("""
                    INSERT INTO ai_usage_daily(day, calls, prompt_tokens, completion_tokens, total_tokens, updated_at)
                    VALUES(?, 1, ?, ?, ?, ?)
                    ON CONFLICT(day) DO UPDATE SET
                      calls = calls + 1,
                      prompt_tokens = prompt_tokens + excluded.prompt_tokens,
                      completion_tokens = completion_tokens + excluded.completion_tokens,
                      total_tokens = total_tokens + excluded.total_tokens,
                      updated_at = excluded.updated_at
                    """,
                    LocalDate.now().toString(), prompt, completion, total, LocalDateTime.now().toString());
        } catch (RuntimeException error) {
            log.warn("写入 AI 用量失败（不影响本次调用）: {}", error.getMessage());
        }
    }

    /** 今日累计；没有记录时返回全 0，不抛异常。 */
    public Map<String, Object> today() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("day", LocalDate.now().toString());
        value.put("calls", 0);
        value.put("promptTokens", 0);
        value.put("completionTokens", 0);
        value.put("totalTokens", 0);
        try {
            jdbc.queryForObject(
                    "SELECT calls, prompt_tokens, completion_tokens, total_tokens FROM ai_usage_daily WHERE day = ?",
                    (rs, rowNum) -> {
                        value.put("calls", rs.getInt("calls"));
                        value.put("promptTokens", rs.getInt("prompt_tokens"));
                        value.put("completionTokens", rs.getInt("completion_tokens"));
                        value.put("totalTokens", rs.getInt("total_tokens"));
                        return value;
                    },
                    LocalDate.now().toString());
        } catch (RuntimeException ignore) {
            // 今天还没调用过
        }
        return value;
    }

    /** 本次投递运行（进程内）的累计。 */
    public Map<String, Object> run() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("calls", runCalls.get());
        value.put("promptTokens", runPrompt.get());
        value.put("completionTokens", runCompletion.get());
        value.put("totalTokens", runTotal.get());
        return value;
    }

    /** 投递开始时清零「本次运行」，不影响今日累计。 */
    public void resetRun() {
        runCalls.set(0);
        runPrompt.set(0);
        runCompletion.set(0);
        runTotal.set(0);
    }

    public int runCalls() {
        return runCalls.get();
    }

    public int todayCalls() {
        Object value = today().get("calls");
        return value instanceof Number number ? number.intValue() : 0;
    }

    /**
     * 预算闸门。在发起请求之前调用，超限直接抛 {@link AiQuotaExceededException}，
     * 由调用方回退到固定文案 —— 宁可少一条个性化招呼语，也不要跑到天亮才发现账单爆了。
     *
     * @param runLimit   本次运行上限，0 或负数表示不限
     * @param dailyLimit 今日上限，0 或负数表示不限
     */
    public void assertWithin(int runLimit, int dailyLimit) {
        if (runLimit > 0 && runCalls.get() >= runLimit) {
            throw new AiQuotaExceededException(
                    "本次运行已达 AI 调用上限（" + runLimit + " 次），后续岗位改用固定招呼语。可在「设置 → AI 设置」调整。");
        }
        if (dailyLimit > 0 && todayCalls() >= dailyLimit) {
            throw new AiQuotaExceededException(
                    "今日 AI 调用已达上限（" + dailyLimit + " 次），后续岗位改用固定招呼语。可在「设置 → AI 设置」调整。");
        }
    }
}
