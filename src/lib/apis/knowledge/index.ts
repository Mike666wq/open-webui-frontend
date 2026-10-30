import { WEBUI_API_BASE_URL } from '$lib/constants';

export const createNewKnowledge = async (
	token: string,
	name: string,
	description: string,
	accessGrants: object[]
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/create`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			name: name,
			description: description,
			access_grants: accessGrants
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getExternalKnowledgeConnections = async (token: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/connections`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const createExternalKnowledgeConnection = async (token: string, connection: object) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/connections`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(connection)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateExternalKnowledgeConnection = async (
	token: string,
	id: string,
	connection: object
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/connections/${id}`, {
		method: 'PATCH',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(connection)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const deleteExternalKnowledgeConnection = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/connections/${id}`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const testExternalKnowledgeConnection = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/connections/${id}/test`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const testExternalKnowledgeRetrieval = async (
	token: string,
	id: string,
	payload: object
) => {
	let error = null;

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/knowledge/external/connections/${id}/retrieve-test`,
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				authorization: `Bearer ${token}`
			},
			body: JSON.stringify(payload)
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const testExternalKnowledgeSource = async (token: string, payload: object) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/source/test`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(payload)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const createExternalKnowledgeSource = async (token: string, payload: object) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/source/create`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(payload)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateExternalKnowledgeSource = async (token: string, id: string, payload: object) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/source/${id}`, {
		method: 'PATCH',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(payload)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const createExternalKnowledge = async (token: string, payload: object) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/external/knowledge/create`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(payload)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getKnowledgeBases = async (token: string = '', page: number | null = null) => {
	let error = null;

	const searchParams = new URLSearchParams();
	if (page) searchParams.append('page', page.toString());

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/?${searchParams.toString()}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const searchKnowledgeBases = async (
	token: string = '',
	query: string | null = null,
	viewOption: string | null = null,
	page: number | null = null,
	source: string | null = null,
	orderBy: string | null = null,
	direction: string | null = null,
	signal?: AbortSignal
) => {
	let error = null;

	const searchParams = new URLSearchParams();
	if (query) searchParams.append('query', query);
	if (viewOption) searchParams.append('view_option', viewOption);
	if (source) searchParams.append('source', source);
	if (page) searchParams.append('page', page.toString());
	if (orderBy) searchParams.append('order_by', orderBy);
	if (direction) searchParams.append('direction', direction);

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/search?${searchParams.toString()}`, {
		method: 'GET',
		signal,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			if (signal?.aborted) return null;
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const searchKnowledgeFiles = async (
	token: string,
	query?: string | null,
	viewOption?: string | null,
	orderBy?: string | null,
	direction?: string | null,
	page: number = 1,
	includeContent: boolean = false
) => {
	let error = null;

	const searchParams = new URLSearchParams();
	if (query) searchParams.append('query', query);
	if (viewOption) searchParams.append('view_option', viewOption);
	if (orderBy) searchParams.append('order_by', orderBy);
	if (direction) searchParams.append('direction', direction);
	searchParams.append('page', page.toString());
	if (includeContent) searchParams.append('include_content', 'true');

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/knowledge/search/files?${searchParams.toString()}`,
		{
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				authorization: `Bearer ${token}`
			}
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getKnowledgeById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const searchKnowledgeFilesById = async (
	token: string,
	id: string,
	query?: string | null,
	viewOption?: string | null,
	orderBy?: string | null,
	direction?: string | null,
	page: number = 1,
	directoryId?: string | null,
	includeContent: boolean = false
) => {
	let error = null;

	const searchParams = new URLSearchParams();
	if (query) searchParams.append('query', query);
	if (viewOption) searchParams.append('view_option', viewOption);
	if (orderBy) searchParams.append('order_by', orderBy);
	if (direction) searchParams.append('direction', direction);
	searchParams.append('page', page.toString());
	// directoryId: undefined = don't filter, null = root, string = specific dir
	if (directoryId !== undefined) {
		searchParams.append('directory_id', directoryId ?? '');
	}
	if (includeContent) searchParams.append('include_content', 'true');

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/knowledge/${id}/files?${searchParams.toString()}`,
		{
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				authorization: `Bearer ${token}`
			}
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getPendingKnowledgeFiles = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/files/pending`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return [];
		});

	if (error) {
		throw error;
	}

	return res;
};

export const streamPendingKnowledgeFiles = async (token: string, id: string) => {
	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/files/pending?stream=true`, {
		method: 'GET',
		headers: {
			Accept: 'text/event-stream',
			authorization: `Bearer ${token}`
		}
	});

	if (!res.ok) {
		throw new Error('Failed to stream pending files');
	}

	return res;
};

type KnowledgeUpdateForm = {
	name?: string;
	description?: string;
	data?: object;
	access_grants?: object[];
};

export const updateKnowledgeById = async (token: string, id: string, form: KnowledgeUpdateForm) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			name: form?.name ? form.name : undefined,
			description: form?.description ? form.description : undefined,
			data: form?.data ? form.data : undefined,
			access_grants: form.access_grants
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateKnowledgeAccessGrants = async (
	token: string,
	id: string,
	accessGrants: any[]
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/access/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ access_grants: accessGrants })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const addFileToKnowledgeById = async (
	token: string,
	id: string,
	fileId: string,
	directoryId?: string | null,
	process?: boolean
) => {
	let error = null;

	const body: Record<string, string | boolean> = { file_id: fileId };
	if (directoryId) body.directory_id = directoryId;
	// Optional process flag (P-006 S4): false = link without vectorizing (images).
	if (process !== undefined) body.process = process;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/file/add`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(body)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateFileFromKnowledgeById = async (token: string, id: string, fileId: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/file/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			file_id: fileId
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const removeFileFromKnowledgeById = async (
	token: string,
	id: string,
	fileId: string,
	confirmShared = false
) => {
	const response = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/file/remove`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ file_id: fileId, confirm_shared: confirmShared })
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw body.detail ?? new Error(`Request failed (${response.status})`);
	return body;
};

export const resetKnowledgeById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/reset`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const syncKnowledgeDiff = async (
	token: string,
	id: string,
	manifest: Array<{ filename: string; path: string; checksum: string; size: number }>
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/sync/diff`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ manifest })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const syncKnowledgeCleanup = async (
	token: string,
	id: string,
	fileIds: string[],
	dirIds: string[] = []
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/sync/cleanup`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ file_ids: fileIds, dir_ids: dirIds })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const deleteKnowledgeById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/delete`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const reindexKnowledgeFiles = async (token: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/reindex`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const reindexKnowledgeMetadata = async (token: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/metadata/reindex`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const exportKnowledgeById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/export`, {
		method: 'GET',
		headers: {
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.blob();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

// ── Directory API ───────────────────────────────────────────────────

export const createKnowledgeDirectory = async (
	token: string,
	id: string,
	name: string,
	parentId?: string | null
) => {
	let error = null;

	const body: Record<string, string | null> = { name };
	if (parentId) body.parent_id = parentId;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/dirs/create`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(body)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateKnowledgeDirectory = async (
	token: string,
	id: string,
	dirId: string,
	form: { name?: string; parent_id?: string | null }
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/dirs/${dirId}/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify(form)
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const deleteKnowledgeDirectory = async (
	token: string,
	id: string,
	dirId: string,
	moveFiles: boolean = true
) => {
	let error = null;

	const searchParams = new URLSearchParams();
	searchParams.append('move_files', moveFiles.toString());

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/knowledge/${id}/dirs/${dirId}/delete?${searchParams.toString()}`,
		{
			method: 'DELETE',
			headers: {
				Accept: 'application/json',
				authorization: `Bearer ${token}`
			}
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const moveFileInKnowledge = async (
	token: string,
	id: string,
	fileId: string,
	directoryId?: string | null
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/file/move`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			file_id: fileId,
			directory_id: directoryId ?? null
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

// P-006 S4 — batch get-or-create directories for Markdown folder import.
// `directories` are normalized, root-relative, parents-first paths
// (`a/b/c`). Returns `{ "<path>": "<directoryId>" }`; idempotent.
export const batchCreateKnowledgeDirectories = async (
	token: string,
	id: string,
	directories: string[]
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/directory/batch`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ directories })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export type KnowledgeImportFile = {
	file: File;
	directoryId: string | null;
	sourcePath: string;
	sourceHash: string;
	operationId: string;
	kind: 'markdown' | 'image';
	indexText?: string;
};

export type KnowledgeImportResult = {
	file_id: string;
	directory_id: string | null;
	source_path: string;
	operation_id: string;
	status: 'completed' | 'unconfirmed';
	indexed: boolean;
};

export class KnowledgeImportError extends Error {
	constructor(
		message: string,
		public stage = 'confirmation',
		public cleanupStatus = 'not_needed',
		public fileId?: string,
		public unconfirmed = false
	) {
		super(message);
	}
}

export const importKnowledgeFile = async (
	token: string,
	id: string,
	item: KnowledgeImportFile
): Promise<KnowledgeImportResult> => {
	const form = new FormData();
	form.append('file', item.file);
	if (item.directoryId) form.append('directory_id', item.directoryId);
	form.append('source_path', item.sourcePath);
	form.append('source_hash', item.sourceHash);
	form.append('operation_id', item.operationId);
	form.append('kind', item.kind);
	if (item.indexText !== undefined) form.append('index_text', item.indexText);
	let response: Response;
	try {
		response = await fetch(`${WEBUI_API_BASE_URL}/knowledge/${id}/import/file`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
			body: form
		});
	} catch {
		throw new KnowledgeImportError(
			'The server response was lost; check the operation before retrying.',
			'confirmation',
			'pending',
			undefined,
			true
		);
	}
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		const detail = body?.detail;
		if (
			response.status === 404 &&
			(typeof detail !== 'object' || detail?.stage !== 'authorization')
		) {
			throw new KnowledgeImportError(
				'This server does not support safe folder imports; upgrade the backend.',
				'validation'
			);
		}
		throw new KnowledgeImportError(
			typeof detail === 'string' ? detail : detail?.message || `Import failed (${response.status})`,
			detail?.stage || 'validation',
			detail?.cleanup_status || 'not_needed',
			detail?.file_id,
			detail?.code === 'operation_unconfirmed'
		);
	}
	return response.json();
};

export const getKnowledgeImportOperation = async (
	token: string,
	id: string,
	operationId: string
): Promise<KnowledgeImportResult> => {
	const response = await fetch(
		`${WEBUI_API_BASE_URL}/knowledge/${id}/import/operations/${operationId}`,
		{
			headers: { authorization: `Bearer ${token}` }
		}
	);
	if (!response.ok)
		throw new KnowledgeImportError(
			'Could not confirm the operation.',
			'confirmation',
			'pending',
			undefined,
			true
		);
	return response.json();
};
