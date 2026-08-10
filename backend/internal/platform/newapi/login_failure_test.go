package newapi

import "testing"

func TestClassifyLoginFailure(t *testing.T) {
	tests := []struct {
		name   string
		result LoginResult
		want   LoginFailureKind
	}{
		{name: "缺少验证码", result: LoginResult{Message: "Turnstile token 为空"}, want: LoginFailureVerificationRequired},
		{name: "验证码校验失败", result: LoginResult{Message: "Turnstile 校验失败，请刷新重试！"}, want: LoginFailureVerificationFailed},
		{name: "密码错误", result: LoginResult{Message: "用户名或密码错误，或用户已被封禁"}, want: LoginFailureInvalidCredentials},
		{name: "英文密码错误", result: LoginResult{Message: "Username or password is incorrect, or user has been banned"}, want: LoginFailureInvalidCredentials},
		{name: "未知失败", result: LoginResult{Message: "数据库出错，请联系管理员"}, want: LoginFailureUnknown},
		{name: "成功结果", result: LoginResult{Success: true, Message: "登录成功"}, want: LoginFailureUnknown},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := ClassifyLoginFailure(test.result); got != test.want {
				t.Fatalf("unexpected failure kind: got %q want %q", got, test.want)
			}
		})
	}
}
