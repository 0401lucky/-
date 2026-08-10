package newapi

import "strings"

// LoginFailureKind 用于把 new-api 的登录失败归类为可安全处理的业务类型。
// 未知消息不会被当作密码错误，避免验证码或上游故障触发福利站锁定。
type LoginFailureKind string

const (
	LoginFailureUnknown              LoginFailureKind = "unknown"
	LoginFailureVerificationRequired LoginFailureKind = "verification_required"
	LoginFailureVerificationFailed   LoginFailureKind = "verification_failed"
	LoginFailureInvalidCredentials   LoginFailureKind = "invalid_credentials"
)

// ClassifyLoginFailure 按当前 new-api fork 的稳定消息分类登录失败。
// 不把完整消息写入日志或向调用方暴露以外的地方；调用方可自行选择用户提示。
func ClassifyLoginFailure(result LoginResult) LoginFailureKind {
	if result.Success {
		return LoginFailureUnknown
	}

	message := strings.TrimSpace(result.Message)
	switch message {
	case "Turnstile token 为空":
		return LoginFailureVerificationRequired
	case "Turnstile 校验失败，请刷新重试！":
		return LoginFailureVerificationFailed
	case "用户名或密码错误", "用户名或密码错误，或用户已被封禁",
		"Username or password is incorrect, or user has been banned",
		"密码错误":
		return LoginFailureInvalidCredentials
	default:
		return LoginFailureUnknown
	}
}
