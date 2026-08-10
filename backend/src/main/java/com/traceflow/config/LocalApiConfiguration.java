package com.traceflow.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Set;

@Configuration
public class LocalApiConfiguration implements WebMvcConfigurer {
    private final String sessionToken;

    public LocalApiConfiguration(@Value("${traceflow.session-token:}") String sessionToken) {
        this.sessionToken = sessionToken;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new SessionTokenInterceptor(sessionToken)).addPathPatterns("/api/**");
    }

    private record SessionTokenInterceptor(String expectedToken) implements HandlerInterceptor {
        private static final Set<String> LOOPBACKS = Set.of("127.0.0.1", "0:0:0:0:0:0:0:1", "::1");

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
            if (!LOOPBACKS.contains(request.getRemoteAddr())) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN, "仅允许本机访问");
                return false;
            }
            if (expectedToken != null && !expectedToken.isBlank()
                    && !expectedToken.equals(request.getHeader("X-TraceFlow-Token"))) {
                response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "本地会话令牌无效");
                return false;
            }
            return true;
        }
    }
}
