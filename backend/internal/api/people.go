package api

import (
	"net/http"
	"slices"

	"inventarius/internal/auth"
	"inventarius/internal/db"
)

func (s *Server) me(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if u.DepartmentIDs == nil {
		u.DepartmentIDs = []int64{}
	}
	return writeJSON(w, u)
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]any{
		"projects":    projects,
		"departments": s.departments,
		"symbology":   s.cfg.Symbology,
		"label_url":   s.cfg.LabelURL,
		"part_lookup": s.parts != nil,
	})
}

func (s *Server) validDepartments(ids []int64) error {
	for _, id := range ids {
		if !slices.ContainsFunc(s.departments, func(d db.Department) bool { return d.ID == id }) {
			return badRequest("unknown department")
		}
	}
	return nil
}

func (s *Server) replaceDepartments(r *http.Request, userID int64, ids []int64) error {
	if err := s.validDepartments(ids); err != nil {
		return err
	}
	return s.store.Tx(r.Context(), func(q *db.Queries) error {
		if err := q.ClearUserDepartments(r.Context(), userID); err != nil {
			return err
		}
		for _, id := range slices.Compact(slices.Sorted(slices.Values(ids))) {
			if err := q.AddUserDepartment(r.Context(), db.AddUserDepartmentParams{UserID: userID, DepartmentID: id}); err != nil {
				return err
			}
		}
		return nil
	})
}

// setMyDepartments lets people pick their own departments; membership only
// widens what they can edit within their own project.
func (s *Server) setMyDepartments(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var body struct {
		DepartmentIDs []int64 `json:"department_ids"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	if err := s.replaceDepartments(r, u.ID, body.DepartmentIDs); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type userView struct {
	db.User
	DepartmentIDs []int64 `json:"department_ids"`
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		return err
	}
	links, err := s.store.ListAllUserDepartments(r.Context())
	if err != nil {
		return err
	}
	byUser := map[int64][]int64{}
	for _, l := range links {
		byUser[l.UserID] = append(byUser[l.UserID], l.DepartmentID)
	}
	out := make([]userView, len(users))
	for i, usr := range users {
		out[i] = userView{User: usr, DepartmentIDs: byUser[usr.ID]}
		if out[i].DepartmentIDs == nil {
			out[i].DepartmentIDs = []int64{}
		}
	}
	return writeJSON(w, out)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if err := requireAdmin(u); err != nil {
		return err
	}
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var body struct {
		Role          *string  `json:"role"`
		Active        *bool    `json:"active"`
		DepartmentIDs *[]int64 `json:"department_ids"`
	}
	if err := decode(r, &body); err != nil {
		return err
	}
	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		return err
	}
	role, active := target.Role, target.Active
	if body.Role != nil {
		switch *body.Role {
		case "member", "dept_lead", "admin":
			role = *body.Role
		default:
			return badRequest("unknown role")
		}
	}
	if body.Active != nil {
		active = *body.Active
	}
	if id == u.ID && (role != "admin" || !active) {
		return badRequest("you cannot remove your own admin access")
	}
	if err := s.store.UpdateUserAccess(r.Context(), db.UpdateUserAccessParams{Role: role, Active: active, ID: id}); err != nil {
		return err
	}
	if body.DepartmentIDs != nil {
		if err := s.replaceDepartments(r, id, *body.DepartmentIDs); err != nil {
			return err
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
