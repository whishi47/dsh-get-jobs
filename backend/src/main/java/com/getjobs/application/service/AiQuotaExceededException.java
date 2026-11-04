package com.getjobs.application.service;

/**
 * AI 调用超出预算上限。
 *
 * <p>刻意设计成 RuntimeException：调用方（投递、简历解析、面板润色）都已有
 * catch-all 的降级分支，抛这个异常就能让它们回到"不用 AI 也能继续"的路径，
 * 而不是把整次投递打断。
 */
public class AiQuotaExceededException extends RuntimeException {

    public AiQuotaExceededException(String message) {
        super(message);
    }
}
