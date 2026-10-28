package newapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

var (
	ErrOIDCNotBound     = errors.New("OIDC identity is not bound to a new-api account")
	ErrOIDCUserDisabled = errors.New("new-api account is disabled or deleted")
	ErrOIDCAmbiguous    = errors.New("OIDC identity matches multiple new-api accounts")
)

type OIDCAccountQuery struct {
	Provider    string
	ProviderID  int64
	Subject     string
	Username    string
	Email       string
	KnownUserID int64
}

// Account names only narrow the search. Authentication requires an exact provider binding.
func (client *Client) ResolveOIDCAccount(ctx context.Context, query OIDCAccountQuery) (*User, error) {
	if query.Subject == "" || (query.Provider != "oidc" && query.Provider != "custom") || (query.Provider == "custom" && query.ProviderID <= 0) {
		return nil, ErrOIDCNotBound
	}
	if query.KnownUserID > 0 {
		return client.verifyOIDCAccount(ctx, query.KnownUserID, query)
	}
	seen := map[int64]bool{}
	var matched *User
	for _, keyword := range []string{strings.TrimSpace(query.Username), strings.TrimSpace(query.Email)} {
		if keyword == "" {
			continue
		}
		users, err := client.searchOIDCAccounts(ctx, keyword)
		if err != nil {
			return nil, err
		}
		for _, candidate := range users {
			if seen[candidate.ID] || (candidate.Username != keyword && !strings.EqualFold(candidate.Email, keyword)) {
				continue
			}
			seen[candidate.ID] = true
			user, err := client.verifyOIDCAccount(ctx, candidate.ID, query)
			if errors.Is(err, ErrOIDCNotBound) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if matched != nil && matched.ID != user.ID {
				return nil, ErrOIDCAmbiguous
			}
			matched = user
		}
	}
	if matched == nil {
		return nil, ErrOIDCNotBound
	}
	return matched, nil
}

func (client *Client) verifyOIDCAccount(ctx context.Context, userID int64, query OIDCAccountQuery) (*User, error) {
	if userID <= 0 || userID > 9007199254740991 {
		return nil, ErrOIDCNotBound
	}
	data, err := client.fetchUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	bound := false
	if query.Provider == "oidc" {
		id, _ := data["oidc_id"].(string)
		bound = id != "" && id == query.Subject
	} else {
		envelope, err := client.oidcRequest(ctx, fmt.Sprintf("/api/user/%d/oauth/bindings", userID))
		if err != nil {
			return nil, err
		}
		var bindings []struct {
			ProviderID int64  `json:"provider_id"`
			Subject    string `json:"provider_user_id"`
		}
		if err := json.Unmarshal(envelope.Data, &bindings); err != nil {
			return nil, errors.New("invalid new-api OAuth binding response")
		}
		for _, binding := range bindings {
			if binding.ProviderID == query.ProviderID && binding.Subject == query.Subject {
				bound = true
				break
			}
		}
	}
	if !bound {
		return nil, ErrOIDCNotBound
	}
	if readInt64(data["id"]) != userID || readInt64(data["status"]) != 1 ||
		(data["deleted_at"] != nil && data["deleted_at"] != "") || (data["DeletedAt"] != nil && data["DeletedAt"] != "") {
		return nil, ErrOIDCUserDisabled
	}
	username, _ := data["username"].(string)
	displayName, _ := data["display_name"].(string)
	if strings.TrimSpace(username) == "" {
		return nil, errors.New("new-api user is missing a username")
	}
	if strings.TrimSpace(displayName) == "" {
		displayName = username
	}
	return &User{ID: userID, Username: username, DisplayName: displayName, Status: 1}, nil
}

func (client *Client) searchOIDCAccounts(ctx context.Context, keyword string) ([]User, error) {
	var users []User
	// Bound the lookup to prevent an identity claim from initiating a full user export.
	for page := 1; page <= 3; page++ {
		query := url.Values{"keyword": {keyword}, "p": {fmt.Sprint(page)}, "page_size": {"100"}}
		envelope, err := client.oidcRequest(ctx, "/api/user/search?"+query.Encode())
		if err != nil {
			return nil, err
		}
		var pagination struct {
			Items []User `json:"items"`
			Total int64  `json:"total"`
		}
		if err := json.Unmarshal(envelope.Data, &pagination); err != nil {
			// Older new-api versions return data as an array rather than a page object.
			if err := json.Unmarshal(envelope.Data, &pagination.Items); err != nil {
				return nil, errors.New("invalid new-api user search response")
			}
			users = append(users, pagination.Items...)
			break
		}
		users = append(users, pagination.Items...)
		if len(pagination.Items) < 100 || int64(page*100) >= pagination.Total {
			break
		}
	}
	return users, nil
}

func (client *Client) oidcRequest(ctx context.Context, path string) (rawAPIEnvelope, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+path, nil)
	if err != nil {
		return rawAPIEnvelope{}, err
	}
	client.setAuthHeaders(request)
	envelope, err := client.doRawJSONWithAdminAuthRetry(request)
	if err != nil {
		return rawAPIEnvelope{}, err
	}
	if !envelope.Success || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return rawAPIEnvelope{}, errors.New("new-api account lookup failed")
	}
	return envelope, nil
}
