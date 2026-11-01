export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_pending_actions: {
        Row: {
          args: Json
          created_at: string
          executed_at: string | null
          expires_at: string
          id: string
          team_id: string
          tool_name: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          args: Json
          created_at?: string
          executed_at?: string | null
          expires_at: string
          id?: string
          team_id: string
          tool_name: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          args?: Json
          created_at?: string
          executed_at?: string | null
          expires_at?: string
          id?: string
          team_id?: string
          tool_name?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_pending_actions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_requests: {
        Row: {
          asked_at: string
          id: string
          message: string
          ms: number | null
          outcome: string
          page: string | null
          reply: string | null
          request_id: string
          steps: Json
          team_id: string
          time_zone: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          asked_at?: string
          id?: string
          message: string
          ms?: number | null
          outcome: string
          page?: string | null
          reply?: string | null
          request_id: string
          steps?: Json
          team_id: string
          time_zone?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          asked_at?: string
          id?: string
          message?: string
          ms?: number | null
          outcome?: string
          page?: string | null
          reply?: string | null
          request_id?: string
          steps?: Json
          team_id?: string
          time_zone?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          history_from: string | null
          joined_at: string
          left_at: string | null
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          history_from?: string | null
          joined_at?: string
          left_at?: string | null
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          history_from?: string | null
          joined_at?: string
          left_at?: string | null
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_conversation_team_fkey"
            columns: ["conversation_id", "team_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "conversation_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_preferences: {
        Row: {
          conversation_id: string
          following: boolean
          notification_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          following?: boolean
          notification_mode?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          conversation_id?: string
          following?: boolean
          notification_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_preferences_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_message_at: string | null
          last_message_id: string | null
          last_thread_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_thread_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          conversation_id?: string
          last_message_at?: string | null
          last_message_id?: string | null
          last_thread_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_archived: boolean
          kind: string
          name: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          kind: string
          name?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_archived?: boolean
          kind?: string
          name?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      course_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          revoked_at: string | null
          team_id: string
          used_at: string | null
          used_by: string | null
          workspace_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          revoked_at?: string | null
          team_id: string
          used_at?: string | null
          used_by?: string | null
          workspace_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          revoked_at?: string | null
          team_id?: string
          used_at?: string | null
          used_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_codes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_codes_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      diagrams: {
        Row: {
          access: Database["public"]["Enums"]["file_access"]
          created_at: string
          created_by: string | null
          data: Json
          folder_id: string | null
          id: string
          lesson_id: string | null
          team_id: string
          title: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          access?: Database["public"]["Enums"]["file_access"]
          created_at?: string
          created_by?: string | null
          data?: Json
          folder_id?: string | null
          id?: string
          lesson_id?: string | null
          team_id: string
          title: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          access?: Database["public"]["Enums"]["file_access"]
          created_at?: string
          created_by?: string | null
          data?: Json
          folder_id?: string | null
          id?: string
          lesson_id?: string | null
          team_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diagrams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagrams_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagrams_lesson_fkey"
            columns: ["lesson_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "diagrams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagrams_workspace_team_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      doc_folders: {
        Row: {
          access: Database["public"]["Enums"]["file_access"]
          created_at: string
          created_by: string | null
          depth: number
          id: string
          is_lessons_root: boolean
          is_plans_root: boolean
          lesson_id: string | null
          name: string
          parent_id: string | null
          plan_id: string | null
          team_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          access?: Database["public"]["Enums"]["file_access"]
          created_at?: string
          created_by?: string | null
          depth: number
          id?: string
          is_lessons_root?: boolean
          is_plans_root?: boolean
          lesson_id?: string | null
          name: string
          parent_id?: string | null
          plan_id?: string | null
          team_id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          access?: Database["public"]["Enums"]["file_access"]
          created_at?: string
          created_by?: string | null
          depth?: number
          id?: string
          is_lessons_root?: boolean
          is_plans_root?: boolean
          lesson_id?: string | null
          name?: string
          parent_id?: string | null
          plan_id?: string | null
          team_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_lesson_fkey"
            columns: ["lesson_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "doc_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_workspace_team_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      documents: {
        Row: {
          access: Database["public"]["Enums"]["file_access"]
          body: Json | null
          content: string
          created_at: string
          created_by: string | null
          folder_id: string | null
          id: string
          lesson_id: string | null
          team_id: string
          title: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          access?: Database["public"]["Enums"]["file_access"]
          body?: Json | null
          content?: string
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          lesson_id?: string | null
          team_id: string
          title: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          access?: Database["public"]["Enums"]["file_access"]
          body?: Json | null
          content?: string
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          lesson_id?: string | null
          team_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_lesson_fkey"
            columns: ["lesson_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "documents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_workspace_team_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          last_error: string | null
          payload: Json
          recipient_id: string | null
          recipients: number
          ref_id: string
          send_after: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          last_error?: string | null
          payload?: Json
          recipient_id?: string | null
          recipients?: number
          ref_id: string
          send_after?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          last_error?: string | null
          payload?: Json
          recipient_id?: string | null
          recipients?: number
          ref_id?: string
          send_after?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          chat: boolean
          meetings: boolean
          reminders: boolean
          time_zone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat?: boolean
          meetings?: boolean
          reminders?: boolean
          time_zone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat?: boolean
          meetings?: boolean
          reminders?: boolean
          time_zone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      error_group_days: {
        Row: {
          count: number
          day: string
          group_id: string
        }
        Insert: {
          count: number
          day: string
          group_id: string
        }
        Update: {
          count?: number
          day?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "error_group_days_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "error_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      error_groups: {
        Row: {
          created_at: string
          fingerprint: string
          first_seen: string
          id: string
          issue_id: string | null
          last_seen: string
          needs_issue: boolean
          previous_issue_id: string | null
          raw: string
          source_id: string
          team_id: string
          title: string
          total_count: number
          updated_at: string
          url: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          first_seen: string
          id?: string
          issue_id?: string | null
          last_seen: string
          needs_issue?: boolean
          previous_issue_id?: string | null
          raw?: string
          source_id: string
          team_id: string
          title: string
          total_count?: number
          updated_at?: string
          url?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          first_seen?: string
          id?: string
          issue_id?: string | null
          last_seen?: string
          needs_issue?: boolean
          previous_issue_id?: string | null
          raw?: string
          source_id?: string
          team_id?: string
          title?: string
          total_count?: number
          updated_at?: string
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "error_groups_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_groups_previous_issue_id_fkey"
            columns: ["previous_issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_groups_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "error_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_groups_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      error_sources: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          label_id: string | null
          last_sync_message: string | null
          last_sync_ok: boolean | null
          last_synced_at: string | null
          name: string
          plan_id: string | null
          provider: string
          sync_requested_at: string | null
          team_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          label_id?: string | null
          last_sync_message?: string | null
          last_sync_ok?: boolean | null
          last_synced_at?: string | null
          name: string
          plan_id?: string | null
          provider: string
          sync_requested_at?: string | null
          team_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          label_id?: string | null
          last_sync_message?: string | null
          last_sync_ok?: boolean | null
          last_synced_at?: string | null
          name?: string
          plan_id?: string | null
          provider?: string
          sync_requested_at?: string | null
          team_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "error_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_sources_label_fkey"
            columns: ["label_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issue_labels"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "error_sources_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_sources_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          default_enabled: boolean
          description: string
          details: string
          key: string
          parent: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_enabled?: boolean
          description: string
          details?: string
          key: string
          parent?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_enabled?: boolean
          description?: string
          details?: string
          key?: string
          parent?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_parent_fkey"
            columns: ["parent"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
        ]
      }
      feedback: {
        Row: {
          context: Json
          created_at: string
          done_at: string | null
          id: string
          kind: string
          message: string
          page: string | null
          status: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          done_at?: string | null
          id?: string
          kind: string
          message: string
          page?: string | null
          status?: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          done_at?: string | null
          id?: string
          kind?: string
          message?: string
          page?: string | null
          status?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      file_shares: {
        Row: {
          created_at: string
          created_by: string | null
          diagram_id: string | null
          document_id: string | null
          folder_id: string | null
          id: string
          role: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          diagram_id?: string | null
          document_id?: string | null
          folder_id?: string | null
          id?: string
          role?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          diagram_id?: string | null
          document_id?: string | null
          folder_id?: string | null
          id?: string
          role?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_diagram_id_fkey"
            columns: ["diagram_id"]
            isOneToOne: false
            referencedRelation: "diagrams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_shares_member_fkey"
            columns: ["team_id", "user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["team_id", "user_id"]
          },
        ]
      }
      github_connect_states: {
        Row: {
          created_at: string
          state: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_connect_states_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_connect_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations: {
        Row: {
          account_login: string
          account_type: string
          connected_by: string | null
          created_at: string
          installation_id: number
          team_id: string
        }
        Insert: {
          account_login: string
          account_type: string
          connected_by?: string | null
          created_at?: string
          installation_id: number
          team_id: string
        }
        Update: {
          account_login?: string
          account_type?: string
          connected_by?: string | null
          created_at?: string
          installation_id?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_installations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      github_webhook_deliveries: {
        Row: {
          delivery_id: string
          event: string
          received_at: string
        }
        Insert: {
          delivery_id: string
          event: string
          received_at?: string
        }
        Update: {
          delivery_id?: string
          event?: string
          received_at?: string
        }
        Relationships: []
      }
      issue_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          from_value: string | null
          id: number
          issue_id: string
          kind: string
          to_value: string | null
          via: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_value?: string | null
          id?: never
          issue_id: string
          kind: string
          to_value?: string | null
          via?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_value?: string | null
          id?: never
          issue_id?: string
          kind?: string
          to_value?: string | null
          via?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_activity_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      issue_branches: {
        Row: {
          base: string
          created_at: string
          created_by: string | null
          id: string
          issue_id: string
          name: string
          repo_id: string
          sha: string
          workspace_id: string
        }
        Insert: {
          base: string
          created_at?: string
          created_by?: string | null
          id?: string
          issue_id: string
          name: string
          repo_id: string
          sha: string
          workspace_id: string
        }
        Update: {
          base?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issue_id?: string
          name?: string
          repo_id?: string
          sha?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_branches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_branches_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "issue_branches_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          issue_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          issue_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          issue_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_comments_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      issue_cycles: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string | null
          number: number
          starts_on: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name?: string | null
          number: number
          starts_on: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string | null
          number?: number
          starts_on?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_cycles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_import_people: {
        Row: {
          created_at: string
          name: string
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          name: string
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          name?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_import_people_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_import_people_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_label_links: {
        Row: {
          issue_id: string
          label_id: string
          workspace_id: string
        }
        Insert: {
          issue_id: string
          label_id: string
          workspace_id: string
        }
        Update: {
          issue_id?: string
          label_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_label_links_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "issue_label_links_label_fkey"
            columns: ["label_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issue_labels"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      issue_labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_pins: {
        Row: {
          created_at: string
          cycle_id: string | null
          id: string
          issue_id: string | null
          kind: string
          person_id: string | null
          plan_id: string | null
          position: number
          tab: string | null
          team_id: string
          user_id: string
          view_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          cycle_id?: string | null
          id?: string
          issue_id?: string | null
          kind: string
          person_id?: string | null
          plan_id?: string | null
          position?: number
          tab?: string | null
          team_id: string
          user_id?: string
          view_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          cycle_id?: string | null
          id?: string
          issue_id?: string | null
          kind?: string
          person_id?: string | null
          plan_id?: string | null
          position?: number
          tab?: string | null
          team_id?: string
          user_id?: string
          view_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issue_pins_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "issue_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_view_id_fkey"
            columns: ["view_id"]
            isOneToOne: false
            referencedRelation: "issue_views"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_pins_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      issue_pull_requests: {
        Row: {
          author_login: string | null
          base_ref: string
          created_at: string
          github_pr_id: number
          head_ref: string
          id: string
          issue_id: string
          landed_ref: string | null
          merged_at: string | null
          number: number
          repo_id: string
          state: string
          title: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          author_login?: string | null
          base_ref: string
          created_at?: string
          github_pr_id: number
          head_ref: string
          id?: string
          issue_id: string
          landed_ref?: string | null
          merged_at?: string | null
          number: number
          repo_id: string
          state: string
          title: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          author_login?: string | null
          base_ref?: string
          created_at?: string
          github_pr_id?: number
          head_ref?: string
          id?: string
          issue_id?: string
          landed_ref?: string | null
          merged_at?: string | null
          number?: number
          repo_id?: string
          state?: string
          title?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_pull_requests_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "issue_pull_requests_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_views: {
        Row: {
          created_at: string
          filters: Json
          id: string
          layout: string
          name: string
          owner_id: string
          shared: boolean
          tab: string
          team_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          layout?: string
          name: string
          owner_id?: string
          shared?: boolean
          tab?: string
          team_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          layout?: string
          name?: string
          owner_id?: string
          shared?: boolean
          tab?: string
          team_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_views_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      issues: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          cycle_id: string | null
          description: Json | null
          due_date: string | null
          estimate: number | null
          id: string
          import_assignee: string | null
          import_ref: string | null
          import_source: string | null
          number: number
          parent_id: string | null
          plan_id: string | null
          priority: number
          repo_id: string | null
          status: Database["public"]["Enums"]["issue_status"]
          team_id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          description?: Json | null
          due_date?: string | null
          estimate?: number | null
          id?: string
          import_assignee?: string | null
          import_ref?: string | null
          import_source?: string | null
          number: number
          parent_id?: string | null
          plan_id?: string | null
          priority?: number
          repo_id?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          team_id: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string | null
          description?: Json | null
          due_date?: string | null
          estimate?: number | null
          id?: string
          import_assignee?: string | null
          import_ref?: string | null
          import_source?: string | null
          number?: number
          parent_id?: string | null
          plan_id?: string | null
          priority?: number
          repo_id?: string | null
          status?: Database["public"]["Enums"]["issue_status"]
          team_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "issue_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_workspace_team_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      learning_modules: {
        Row: {
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_modules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string
          lesson_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string
          lesson_id: string
          user_id?: string
          workspace_id: string
        }
        Update: {
          completed_at?: string
          lesson_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_fkey"
            columns: ["lesson_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "lesson_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          body: Json | null
          created_at: string
          created_by: string | null
          doc_id: string | null
          folder_id: string | null
          id: string
          module_id: string
          position: number
          title: string
          updated_at: string
          whiteboard_id: string | null
          workspace_id: string
        }
        Insert: {
          body?: Json | null
          created_at?: string
          created_by?: string | null
          doc_id?: string | null
          folder_id?: string | null
          id?: string
          module_id: string
          position?: number
          title: string
          updated_at?: string
          whiteboard_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: Json | null
          created_at?: string
          created_by?: string | null
          doc_id?: string | null
          folder_id?: string | null
          id?: string
          module_id?: string
          position?: number
          title?: string
          updated_at?: string
          whiteboard_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_fkey"
            columns: ["module_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "learning_modules"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "lessons_whiteboard_id_fkey"
            columns: ["whiteboard_id"]
            isOneToOne: false
            referencedRelation: "diagrams"
            referencedColumns: ["id"]
          },
        ]
      }
      live_session_rsvps: {
        Row: {
          session_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          session_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_session_rsvps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_session_rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_sessions: {
        Row: {
          calendar_event_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string
          id: string
          room_name: string
          series_id: string | null
          starts_at: string
          team_id: string
          title: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at: string
          id?: string
          room_name?: string
          series_id?: string | null
          starts_at: string
          team_id: string
          title: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string
          id?: string
          room_name?: string
          series_id?: string | null
          starts_at?: string
          team_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sessions_workspace_team_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          conversation_id: string
          created_at: string
          file_name: string
          file_size: number
          id: string
          message_id: string
          mime_type: string
          storage_path: string
          team_id: string
          uploaded_by: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          file_name: string
          file_size: number
          id?: string
          message_id: string
          mime_type: string
          storage_path: string
          team_id: string
          uploaded_by?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          file_name?: string
          file_size?: number
          id?: string
          message_id?: string
          mime_type?: string
          storage_path?: string
          team_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_conversation_fkey"
            columns: ["message_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id", "conversation_id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_mentions: {
        Row: {
          conversation_id: string
          created_at: string
          mentioned_user_id: string
          message_id: string
          team_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          mentioned_user_id: string
          message_id: string
          team_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          mentioned_user_id?: string
          message_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_mentions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_mentions_conversation_team_fkey"
            columns: ["conversation_id", "team_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "message_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_mentions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      message_pins: {
        Row: {
          conversation_id: string
          message_id: string
          pinned_at: string
          pinned_by: string
          team_id: string
        }
        Insert: {
          conversation_id: string
          message_id: string
          pinned_at?: string
          pinned_by?: string
          team_id: string
        }
        Update: {
          conversation_id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_conversation_team_fkey"
            columns: ["conversation_id", "team_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "message_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_pins_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          message_id: string
          team_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          message_id: string
          team_id: string
          user_id?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          message_id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_fkey"
            columns: ["conversation_id", "team_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_id: string
          body: Json
          client_id: string
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_id: string | null
          team_id: string
        }
        Insert: {
          author_id?: string
          body: Json
          client_id: string
          content: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          team_id: string
        }
        Update: {
          author_id?: string
          body?: Json
          client_id?: string
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_team_fkey"
            columns: ["conversation_id", "team_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          conversation_id: string | null
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          message_id: string | null
          read_at: string | null
          recipient_id: string
          reminder_id: string | null
          team_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          message_id?: string | null
          read_at?: string | null
          recipient_id?: string
          reminder_id?: string | null
          team_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          message_id?: string | null
          read_at?: string | null
          recipient_id?: string
          reminder_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          brief_id: string | null
          created_at: string
          created_by: string | null
          description: Json | null
          folder_id: string | null
          id: string
          lead_id: string | null
          name: string
          starts_on: string | null
          status: Database["public"]["Enums"]["plan_status"]
          target_on: string | null
          team_id: string
          updated_at: string
          whiteboard_id: string | null
        }
        Insert: {
          brief_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: Json | null
          folder_id?: string | null
          id?: string
          lead_id?: string | null
          name: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          target_on?: string | null
          team_id: string
          updated_at?: string
          whiteboard_id?: string | null
        }
        Update: {
          brief_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: Json | null
          folder_id?: string | null
          id?: string
          lead_id?: string | null
          name?: string
          starts_on?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          target_on?: string | null
          team_id?: string
          updated_at?: string
          whiteboard_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_whiteboard_id_fkey"
            columns: ["whiteboard_id"]
            isOneToOne: false
            referencedRelation: "diagrams"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          issue_id: string | null
          notes: string | null
          notified_at: string | null
          remind_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          team_id: string
          title: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          notes?: string | null
          notified_at?: string | null
          remind_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          team_id: string
          title: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          issue_id?: string | null
          notes?: string | null
          notified_at?: string | null
          remind_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          team_id?: string
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_issue_fkey"
            columns: ["issue_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "reminders_member_fkey"
            columns: ["team_id", "user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["team_id", "user_id"]
          },
          {
            foreignKeyName: "reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      repos: {
        Row: {
          created_at: string
          created_by: string | null
          github_repo_id: number | null
          id: string
          installation_id: number | null
          name: string
          owner: string
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          github_repo_id?: number | null
          id?: string
          installation_id?: number | null
          name: string
          owner: string
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          github_repo_id?: number | null
          id?: string
          installation_id?: number | null
          name?: string
          owner?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "repos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repos_installation_fkey"
            columns: ["team_id", "installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["team_id", "installation_id"]
          },
          {
            foreignKeyName: "repos_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_feature_flags: {
        Row: {
          enabled: boolean
          flag: string
          team_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          flag: string
          team_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          flag?: string
          team_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_feature_flags_flag_fkey"
            columns: ["flag"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "team_feature_flags_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          team_id: string
          use_count: number
        }
        Insert: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          team_id: string
          use_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          team_id?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["team_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          logo_path: string | null
          name: string
          slug: string
          teachers_set_prices: boolean
          type: Database["public"]["Enums"]["team_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          logo_path?: string | null
          name: string
          slug: string
          teachers_set_prices?: boolean
          type?: Database["public"]["Enums"]["team_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          slug?: string
          teachers_set_prices?: boolean
          type?: Database["public"]["Enums"]["team_type"]
          updated_at?: string
        }
        Relationships: []
      }
      thread_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          message_id: string
          user_id?: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "thread_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_collection_members: {
        Row: {
          added_at: string
          collection_id: string
          team_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          collection_id: string
          team_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          collection_id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_collection_members_collection_fkey"
            columns: ["collection_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspace_collections"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "workspace_collection_members_team_member_fkey"
            columns: ["team_id", "user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["team_id", "user_id"]
          },
          {
            foreignKeyName: "workspace_collection_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_collections: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          position: number
          team_id: string
          type: Database["public"]["Enums"]["team_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          position?: number
          team_id: string
          type?: Database["public"]["Enums"]["team_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          position?: number
          team_id?: string
          type?: Database["public"]["Enums"]["team_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_collections_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          team_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          team_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          team_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_team_id_user_id_fkey"
            columns: ["team_id", "user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["team_id", "user_id"]
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      workspace_modules: {
        Row: {
          created_at: string
          module: Database["public"]["Enums"]["workspace_module"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          module: Database["public"]["Enums"]["workspace_module"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          module?: Database["public"]["Enums"]["workspace_module"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_modules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_pins: {
        Row: {
          pinned_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          pinned_at?: string
          user_id?: string
          workspace_id: string
        }
        Update: {
          pinned_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_pins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_pins_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_repos: {
        Row: {
          base_branch: string | null
          created_at: string
          done_branches: string[]
          repo_id: string
          team_id: string
          workspace_id: string
        }
        Insert: {
          base_branch?: string | null
          created_at?: string
          done_branches?: string[]
          repo_id: string
          team_id: string
          workspace_id: string
        }
        Update: {
          base_branch?: string | null
          created_at?: string
          done_branches?: string[]
          repo_id?: string
          team_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_repos_repo_fkey"
            columns: ["repo_id", "team_id"]
            isOneToOne: false
            referencedRelation: "repos"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "workspace_repos_workspace_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "team_id"]
          },
        ]
      }
      workspaces: {
        Row: {
          access: Database["public"]["Enums"]["workspace_access"]
          collection_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          enrollment: string
          id: string
          issue_key: string
          price_inr: number | null
          price_usd_cents: number | null
          published: boolean
          published_at: string | null
          team_id: string
          title: string
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at: string
        }
        Insert: {
          access?: Database["public"]["Enums"]["workspace_access"]
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enrollment?: string
          id?: string
          issue_key: string
          price_inr?: number | null
          price_usd_cents?: number | null
          published?: boolean
          published_at?: string | null
          team_id: string
          title: string
          type?: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Update: {
          access?: Database["public"]["Enums"]["workspace_access"]
          collection_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          enrollment?: string
          id?: string
          issue_key?: string
          price_inr?: number | null
          price_usd_cents?: number | null
          published?: boolean
          published_at?: string | null
          team_id?: string
          title?: string
          type?: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_collection_fkey"
            columns: ["collection_id", "team_id"]
            isOneToOne: false
            referencedRelation: "workspace_collections"
            referencedColumns: ["id", "team_id"]
          },
          {
            foreignKeyName: "workspaces_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      access_level:
        | {
            Args: { d: Database["public"]["Tables"]["diagrams"]["Row"] }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.access_level(d => documents), public.access_level(d => diagrams). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { d: Database["public"]["Tables"]["documents"]["Row"] }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.access_level(d => documents), public.access_level(d => diagrams). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      add_group_member: {
        Args: {
          p_conversation_id: string
          p_history: string
          p_user_id: string
        }
        Returns: string
      }
      admin_feature_flags: {
        Args: never
        Returns: {
          default_enabled: boolean
          description: string
          details: string
          key: string
          overrides: Json
          parent: string
          updated_at: string
        }[]
      }
      admin_feedback: {
        Args: never
        Returns: {
          context: Json
          created_at: string
          done_at: string
          id: string
          kind: string
          message: string
          page: string
          sender_email: string
          sender_id: string
          sender_name: string
          status: string
          team_name: string
        }[]
      }
      admin_groups: {
        Args: never
        Returns: {
          created_at: string
          enabled_features: string[]
          id: string
          last_activity: string
          member_count: number
          name: string
          owner_email: string
          owner_name: string
          slug: string
          type: Database["public"]["Enums"]["team_type"]
          workspace_count: number
        }[]
      }
      admin_overview: { Args: never; Returns: Json }
      admin_set_feedback_status: {
        Args: { p_id: string; p_status: string }
        Returns: undefined
      }
      admin_set_flag_default: {
        Args: { p_enabled: boolean; p_key: string }
        Returns: undefined
      }
      admin_set_team_flag: {
        Args: { p_enabled: boolean; p_key: string; p_team: string }
        Returns: undefined
      }
      admin_users: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          groups: Json
          id: string
          is_platform_admin: boolean
          last_sign_in_at: string
        }[]
      }
      am_platform_admin: { Args: never; Returns: boolean }
      brief_excerpt: {
        Args: { p: Database["public"]["Tables"]["plans"]["Row"] }
        Returns: string
      }
      can_moderate_live_session: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      conversation_unread_counts: {
        Args: { p_team_id: string }
        Returns: {
          conversation_id: string
          mention_count: number
          unread_count: number
        }[]
      }
      create_channel: {
        Args: { p_description?: string; p_name: string; p_team_id: string }
        Returns: string
      }
      create_course: {
        Args: {
          p_collection_id?: string
          p_description?: string
          p_enrollment?: string
          p_team_id: string
          p_title: string
        }
        Returns: string
      }
      create_course_codes: {
        Args: { p_count?: number; p_note?: string; p_workspace_id: string }
        Returns: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          revoked_at: string | null
          team_id: string
          used_at: string | null
          used_by: string | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "course_codes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_direct_conversation: {
        Args: { p_team_id: string; p_user_id: string }
        Returns: string
      }
      create_error_source: {
        Args: {
          p_api_key?: string
          p_config?: Json
          p_name: string
          p_provider: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_group_conversation: {
        Args: { p_name: string; p_team_id: string; p_user_ids: string[] }
        Returns: string
      }
      create_live_series: {
        Args: {
          p_description: string
          p_duration_minutes: number
          p_starts: string[]
          p_team_id: string
          p_title: string
          p_workspace_id: string
        }
        Returns: {
          id: string
          series_id: string
          starts_at: string
        }[]
      }
      create_plan: {
        Args: { p_name: string; p_team_id: string }
        Returns: string
      }
      create_workspace: {
        Args: {
          p_description: string
          p_modules: Database["public"]["Enums"]["workspace_module"][]
          p_team_id: string
          p_title: string
          p_type: Database["public"]["Enums"]["workspace_type"]
        }
        Returns: string
      }
      create_workspace_in: {
        Args: {
          p_access: Database["public"]["Enums"]["workspace_access"]
          p_collection_id: string
          p_description: string
          p_modules: Database["public"]["Enums"]["workspace_module"][]
          p_team_id: string
          p_title: string
          p_type: Database["public"]["Enums"]["workspace_type"]
        }
        Returns: string
      }
      default_workspace_modules: {
        Args: { workspace_type: Database["public"]["Enums"]["workspace_type"] }
        Returns: Database["public"]["Enums"]["workspace_module"][]
      }
      delete_message: { Args: { p_message_id: string }; Returns: undefined }
      delete_plan: { Args: { p_plan_id: string }; Returns: undefined }
      edit_message: {
        Args: { p_body: Json; p_content: string; p_message_id: string }
        Returns: undefined
      }
      email_claim_batch: {
        Args: { p_daily_cap?: number; p_limit?: number }
        Returns: {
          data: Json
          kind: string
          outbox_id: string
          reply_to: string
          time_zone: string
          to_email: string
        }[]
      }
      email_finish_batch: { Args: { p_results: Json }; Returns: undefined }
      email_prepare_batch: { Args: never; Returns: undefined }
      enabled_features: {
        Args: { t: Database["public"]["Tables"]["teams"]["Row"] }
        Returns: string[]
      }
      enroll_in_course: { Args: { p_workspace_id: string }; Returns: undefined }
      enroll_published_course: {
        Args: { p_course_id: string }
        Returns: string
      }
      ensure_general_channel: { Args: { p_team_id: string }; Returns: string }
      error_create_issue: {
        Args: {
          p_description: Json
          p_group: string
          p_priority?: number
          p_title: string
        }
        Returns: number
      }
      error_finish_sync: {
        Args: {
          p_message: string
          p_ok: boolean
          p_source: string
          p_synced_until?: string
        }
        Returns: undefined
      }
      error_groups_needing_issues: {
        Args: { p_limit?: number; p_source: string }
        Returns: {
          fingerprint: string
          first_seen: string
          id: string
          last_seen: string
          previous_issue_number: number
          raw: string
          title: string
          total_count: number
          url: string
        }[]
      }
      error_record: {
        Args: { p_reports: Json; p_source: string }
        Returns: Json
      }
      error_source_api_key: { Args: { p_source: string }; Returns: string }
      error_source_for_token: {
        Args: { p_source: string; p_token: string }
        Returns: {
          id: string
          provider: string
        }[]
      }
      error_sources_due: {
        Args: { p_source?: string }
        Returns: {
          ai: boolean
          config: Json
          id: string
          issue_key: string
          last_synced_at: string
          name: string
          provider: string
          team_id: string
          workspace_id: string
        }[]
      }
      find_existing_group: {
        Args: { p_team_id: string; p_user_ids: string[] }
        Returns: string
      }
      github_apply_pull_request: {
        Args: {
          p_author_login: string
          p_base_ref: string
          p_github_pr_id: number
          p_head_ref: string
          p_issue_id: string
          p_merged_into_done: boolean
          p_number: number
          p_repo_id: string
          p_state: string
          p_title: string
          p_url: string
        }
        Returns: string
      }
      github_promote_merged: {
        Args: {
          p_from_ref: string
          p_into_done: boolean
          p_repo_id: string
          p_to_ref: string
          p_workspace_id: string
        }
        Returns: number[]
      }
      import_issues: {
        Args: {
          p_cycles?: Json
          p_issues: Json
          p_people?: Json
          p_plans?: Json
          p_source: string
          p_workspace_id: string
        }
        Returns: Json
      }
      import_people: {
        Args: { p_workspace_id: string }
        Returns: {
          name: string
          user_id: string
          waiting: number
        }[]
      }
      join_team: { Args: { invite_code: string }; Returns: string }
      join_with_code: { Args: { p_code: string }; Returns: Json }
      learning_overview: { Args: { p_team_id: string }; Returns: Json }
      lesson_doc_ids: { Args: { p_lesson_ids: string[] }; Returns: string[] }
      lesson_whiteboard: { Args: { p_lesson_id: string }; Returns: string }
      live_session_invitees: {
        Args: { p_session_id: string }
        Returns: {
          email: string
        }[]
      }
      map_import_assignee: {
        Args: { p_name: string; p_user_id: string; p_workspace_id: string }
        Returns: number
      }
      mark_conversation_read: {
        Args: {
          p_conversation_id: string
          p_message_id?: string
          p_thread_at?: string
        }
        Returns: undefined
      }
      mark_thread_read: { Args: { p_parent_id: string }; Returns: undefined }
      move_doc_items: {
        Args: { p_doc_ids: string[]; p_folder_ids: string[]; p_target: string }
        Returns: undefined
      }
      move_folder_items: {
        Args: {
          p_diagram_ids: string[]
          p_doc_ids: string[]
          p_folder_ids: string[]
          p_target: string
        }
        Returns: undefined
      }
      move_open_issues: {
        Args: { p_from: string; p_to: string }
        Returns: number
      }
      plan_files: {
        Args: { p_plan_id: string }
        Returns: {
          doc_ids: string[]
          folders: number
          whiteboards: number
        }[]
      }
      plan_whiteboard: { Args: { p_plan_id: string }; Returns: string }
      public_catalog: { Args: { p_team_slug: string }; Returns: Json }
      public_course: {
        Args: { p_course_id: string; p_team_slug: string }
        Returns: Json
      }
      reorder_issue_pins: {
        Args: { p_ids: string[]; p_team_id: string }
        Returns: undefined
      }
      reorder_learning_modules: {
        Args: { p_ids: string[]; p_workspace_id: string }
        Returns: undefined
      }
      reorder_lessons: {
        Args: { p_ids: string[]; p_module_id: string }
        Returns: undefined
      }
      request_error_sync: { Args: { p_source_id: string }; Returns: undefined }
      revoke_course_code: { Args: { p_code_id: string }; Returns: undefined }
      rotate_error_source_token: {
        Args: { p_source_id: string }
        Returns: string
      }
      save_email_settings: {
        Args: {
          p_chat?: boolean
          p_meetings?: boolean
          p_reminders?: boolean
          p_time_zone?: string
        }
        Returns: undefined
      }
      search_messages: {
        Args: { p_conversation_id?: string; p_query: string; p_team_id: string }
        Returns: {
          author_id: string
          content: string
          conversation_id: string
          created_at: string
          edited_at: string
          id: string
          parent_id: string
          team_id: string
        }[]
      }
      send_feedback: {
        Args: {
          p_context: Json
          p_kind: string
          p_message: string
          p_page: string
          p_team: string
        }
        Returns: string
      }
      send_message: {
        Args: {
          p_body: Json
          p_client_id: string
          p_content: string
          p_conversation_id: string
          p_mention_ids?: string[]
          p_parent_id?: string
        }
        Returns: {
          author_id: string
          body: Json
          client_id: string
          content: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_id: string | null
          team_id: string
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_course_enrollment: {
        Args: { p_enrollment: string; p_workspace_id: string }
        Returns: undefined
      }
      set_course_listing: {
        Args: {
          p_price_inr: number
          p_price_usd_cents: number
          p_published: boolean
          p_workspace_id: string
        }
        Returns: undefined
      }
      set_course_teacher: {
        Args: { p_teacher: boolean; p_user_id: string; p_workspace_id: string }
        Returns: undefined
      }
      set_error_source_plan: {
        Args: {
          p_include_existing?: boolean
          p_plan_id: string
          p_source_id: string
        }
        Returns: number
      }
      set_issue_labels: {
        Args: { p_issue_id: string; p_label_ids: string[] }
        Returns: undefined
      }
      set_live_session_rsvps: {
        Args: { p_responses: Json; p_session_id: string }
        Returns: number
      }
      set_workspace_access: {
        Args: {
          p_access: Database["public"]["Enums"]["workspace_access"]
          p_workspace_id: string
        }
        Returns: undefined
      }
      set_workspace_collection: {
        Args: { p_collection_id: string; p_workspace_id: string }
        Returns: undefined
      }
      set_workspace_modules: {
        Args: {
          p_modules: Database["public"]["Enums"]["workspace_module"][]
          p_workspace_id: string
        }
        Returns: undefined
      }
      start_github_connect: { Args: { p_team_id: string }; Returns: string }
      thread_unread_counts: {
        Args: { p_conversation_id: string }
        Returns: {
          parent_id: string
          unread_count: number
        }[]
      }
      update_error_source_connection: {
        Args: { p_api_key?: string; p_config: Json; p_source_id: string }
        Returns: undefined
      }
      workspace_people: {
        Args: { p_workspace_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          via: string
        }[]
      }
    }
    Enums: {
      file_access: "place" | "restricted"
      issue_status:
        | "backlog"
        | "todo"
        | "in_progress"
        | "in_review"
        | "done"
        | "canceled"
      plan_status:
        | "not_started"
        | "in_progress"
        | "paused"
        | "done"
        | "canceled"
      reminder_status: "pending" | "completed" | "cancelled"
      team_role: "owner" | "admin" | "teacher" | "member"
      team_type: "development" | "learning" | "general"
      workspace_access: "members" | "collection" | "group"
      workspace_module:
        | "issues"
        | "docs"
        | "diagrams"
        | "github"
        | "live"
        | "learning"
        | "exercises"
        | "resources"
      workspace_role: "lead" | "member"
      workspace_type: "project" | "course" | "general"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      file_access: ["place", "restricted"],
      issue_status: [
        "backlog",
        "todo",
        "in_progress",
        "in_review",
        "done",
        "canceled",
      ],
      plan_status: ["not_started", "in_progress", "paused", "done", "canceled"],
      reminder_status: ["pending", "completed", "cancelled"],
      team_role: ["owner", "admin", "teacher", "member"],
      team_type: ["development", "learning", "general"],
      workspace_access: ["members", "collection", "group"],
      workspace_module: [
        "issues",
        "docs",
        "diagrams",
        "github",
        "live",
        "learning",
        "exercises",
        "resources",
      ],
      workspace_role: ["lead", "member"],
      workspace_type: ["project", "course", "general"],
    },
  },
} as const
